import { modelStreamResponse } from "./model-stream-response";
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Exam } from "@/contracts/exams";
import { markCardTemplate, validateCardRegions } from "@/server/answer-cards/layout";
import { gradeCardQuestion, mapConcurrent } from "@/server/answer-cards/grading";
import { createProviderExamModel } from "@/server/ai/providers";
import { z } from "zod";
import { BASIC_MATH_FORMAT } from "@/server/ai/prompts";
const id = "10000000-0000-4000-8000-000000000001";
const exam: Exam = {
  id,
  revision: 0,
  name: "exam",
  totalScore: 2,
  sections: [
    {
      id,
      number: "一",
      title: "计算",
      description: "",
      score: 2,
      questions: [
        { id, number: 1, description: "1+1=?", materials: [], score: 2, subquestions: [] },
      ],
    },
  ],
};
const region = { questionId: id, boxes: [{ page: 1, x: 0.2, y: 0.3, width: 0.5, height: 0.4 }] };
describe("answer card grading", () => {
  it("marks template regions with concise goals, basic math formatting and tolerant tool inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "card-template-unit-"));
    try {
      const path = join(root, "template.jpg");
      await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } })
        .jpeg()
        .toFile(path);
      const result = await markCardTemplate({
        exam,
        files: [path],
        outputDir: join(root, "run"),
        signal: new AbortController().signal,
        model: {
          run: async (request) => {
            expect(request.system).toContain(BASIC_MATH_FORMAT);
            expect(request.system).not.toContain("save_region");
            expect(request.tools.save_region.description).toContain("full blank writing areas");
            const context = { toolCallId: "save", messages: [], context: {} };
            const saved = await request.tools.save_region.execute!(
              { ...region, note: "ready" },
              context,
            );
            expect(saved).toMatchObject({ saved: 1, warning: expect.stringContaining("note") });
            const submitted = await request.tools.submit_regions.execute!({}, context);
            expect(submitted).toMatchObject({ complete: true });
          },
        },
      });
      expect(result.regions).toEqual([region]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("blocks an API request when credit validation fails and rejects a failed settlement", async () => {
    let calls = 0;
    const config = {
      providerId: id,
      name: "test",
      apiType: "openai_chat" as const,
      baseURL: "https://example.com/v1",
      encryptedApiKey: "unused",
      structuredOutputs: false,
      maxOutputTokens: 1024,
      timeoutSeconds: 60,
      maxConcurrency: 3,
      model: "test",
      reasoningEffort: "default" as const,
    };
    const transport: typeof fetch = async () => {
      calls++;
      return modelStreamResponse({
        id: "test",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"score":2}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    };
    const request = { system: "Grade", content: "answer", schema: z.object({ score: z.number() }) };
    const blocked = createProviderExamModel(config, "test", transport, {
      beforeCall: async () => {
        throw new Error("stale");
      },
      record: async () => {},
    });
    await expect(blocked.generateJson(request)).rejects.toThrow("stale");
    expect(calls).toBe(0);
    const failed = createProviderExamModel(config, "test", transport, {
      beforeCall: async () => {},
      record: async () => {
        throw new Error("billing failed");
      },
    });
    await expect(failed.generateJson(request)).rejects.toThrow("用量结算失败");
    expect(calls).toBe(1);
  });
  it("rejects missing coverage, duplicate IDs and invalid page references", () => {
    expect(validateCardRegions([region], exam, [{ page: 1 }])).toEqual([region]);
    expect(() => validateCardRegions([region, region], exam, [{ page: 1 }])).toThrow();
    expect(() =>
      validateCardRegions([{ ...region, boxes: [{ ...region.boxes[0], page: 2 }] }], exam, [
        { page: 1 },
      ]),
    ).toThrow();
    expect(() =>
      validateCardRegions([{ ...region, boxes: [{ ...region.boxes[0], width: 1 }] }], exam, [
        { page: 1 },
      ]),
    ).toThrow();
  });
  it("uses one model call containing a cropped answer image and rejects over-scoring", async () => {
    const root = await mkdtemp(join(tmpdir(), "card-unit-"));
    try {
      const path = join(root, "page.jpg");
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } })
        .jpeg()
        .toFile(path);
      let calls = 0,
        score = 2;
      const model = {
        generateJson: async <T>(request: { system: string; content: import("ai").UserContent }) => {
          calls++;
          expect(request.system).toContain(BASIC_MATH_FORMAT);
          if (!Array.isArray(request.content)) throw new Error("Expected image parts");
          const file = request.content.find((p) => p.type === "file");
          expect(file?.type).toBe("file");
          if (file?.type === "file") {
            const metadata = await sharp(file.data as Buffer).metadata();
            expect(metadata.width).toBe(1000);
            expect(metadata.height).toBe(400);
          }
          return { answer: "2", correct: true, score, feedback: "正确" } as T;
        },
      };
      const options = {
        exam,
        region,
        reference: { questionId: id, solution: "2", gradingCriteria: "2分" },
        pages: [{ page: 1, width: 2000, height: 1000, path }],
        sourceDirectory: root,
        model,
        signal: new AbortController().signal,
      };
      await expect(gradeCardQuestion(options)).resolves.toMatchObject({ questionId: id, score: 2 });
      expect(calls).toBe(1);
      score = 3;
      await expect(gradeCardQuestion(options)).rejects.toThrow("评分不符合");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("bounds a pool shared by students and questions and waits for running work on failure", async () => {
    let active = 0,
      peak = 0,
      finished = 0;
    await expect(
      mapConcurrent([1, 2, 3, 4], 2, async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        finished++;
        if (n === 1) throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(finished).toBe(4);
  });
  it("makes no automatic API retry for one-call grading, even when the server is rate-limited", async () => {
    let calls = 0;
    const model = createProviderExamModel(
      {
        providerId: id,
        name: "test",
        apiType: "openai_chat",
        baseURL: "https://example.com/v1",
        encryptedApiKey: "unused",
        structuredOutputs: false,
        maxOutputTokens: 1024,
        timeoutSeconds: 60,
        maxConcurrency: 3,
        model: "test",
        reasoningEffort: "default",
      },
      "test",
      async () => {
        calls++;
        return Response.json(
          { error: { message: "limited", type: "rate_limit" } },
          { status: 429 },
        );
      },
    );
    await expect(
      model.generateJson({
        system: "Grade",
        content: [{ type: "text", text: "answer" }],
        schema: z.object({ score: z.number() }),
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

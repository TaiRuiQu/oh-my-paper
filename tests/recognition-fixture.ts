import { expect } from "vitest";
import type { RecognitionAgentRequest } from "@/server/ai/agent";
import type { ExamModel, StructuredRequest } from "@/server/ai/deepseek";

export const region = { page: 1, x: 0.1, y: 0.1, width: 0.6, height: 0.5 };
export const question = {
  order: 1,
  number: "1",
  section: "填空",
  type: "fill_blank",
  markdown: "计算 $2+3=$ ____。",
  options: [],
  parts: [],
  points: 5,
  pointsOrigin: "printed",
  pointsReason: "",
  regions: [region],
  materialRefs: [],
  figures: [],
  answerTargets: [{ key: "main", partLabel: null, parentLabel: null, blankIndex: 1 }],
};
export function metadata(pageCount = 1, documentType = "question_paper") {
  return {
    title: "合成试卷",
    subject: "数学",
    grade: null,
    instructions: [],
    sections: [{ title: "填空", points: null }],
    pages: Array.from({ length: pageCount }, (_, i) => ({
      page: i + 1,
      documentType,
      hasQuestionStems: documentType === "question_paper",
      annotationKinds:
        documentType === "answer_sheet"
          ? ["student_answer"]
          : documentType === "answer_key"
            ? ["reference_answer"]
            : [],
    })),
    materials: [],
    findings: [],
  };
}
export function agentFixture(
  run: (
    request: RecognitionAgentRequest,
    call: (name: string, input: unknown) => Promise<Record<string, unknown>>,
  ) => Promise<void>,
  generate?: (request: StructuredRequest<unknown>) => unknown,
): ExamModel {
  return {
    name: "recognition-fixture",
    async generate(request) {
      if (!generate) throw new Error("Unexpected workflow model call.");
      return {
        output: request.schema.parse(generate(request as StructuredRequest<unknown>)),
        inputTokens: 1,
        outputTokens: 1,
      };
    },
    async runRecognitionAgent(request) {
      let calls = 0;
      const call = async (name: string, input: unknown) => {
        request.signal?.throwIfAborted();
        calls++;
        const tool = request.tools[name];
        expect(tool?.execute).toBeDefined();
        await request.onEvent({
          type: "tool_call",
          callId: String(calls),
          tool: name,
          data: input,
        });
        const result = await tool.execute!(input as never, {
          toolCallId: String(calls),
          messages: [],
          context: undefined,
        });
        await request.onEvent({
          type: "tool_result",
          callId: String(calls),
          tool: name,
          data: result,
        });
        return result as Record<string, unknown>;
      };
      await run(request, call);
      if (!request.isComplete())
        throw new Error("Recognition agent stopped without a validated submission.");
      return {
        calls,
        inputTokens: calls,
        outputTokens: calls,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
      };
    },
  };
}

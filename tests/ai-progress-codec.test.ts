import protobuf from "protobufjs";
import { expect, it } from "vitest";
import schema from "@/contracts/ai-progress.schema.json";
import { decodeAiProgress, encodeAiProgress } from "@/lib/ai-progress-codec";
import { aiTraceFixtures } from "./fixtures/ai-traces";
import { aiCostFixture } from "./fixtures/ai-cost";

it("keeps the runtime descriptor in sync with the published .proto contract", () => {
  const root = protobuf.loadSync("src/contracts/ai-progress.proto");
  expect(root.toJSON()).toEqual(schema);
});

it.each(aiTraceFixtures)("round-trips all task fields and nested trace values: $id", (job) => {
  const snapshot = {
    models: [{ id: "model", name: "教学模型" }],
    jobs: [{ ...job, cost: aiCostFixture }],
  };
  const encoded = encodeAiProgress(snapshot);
  expect(encoded).not.toContain("{");
  expect(decodeAiProgress(encoded)).toEqual(snapshot);
});

it("preserves empty values, nulls, false, zero, arrays, objects, unicode and optional presence", () => {
  const snapshot = {
    models: [],
    jobs: [
      {
        ...aiTraceFixtures[0],
        attempts: 0,
        error: "",
        startedAt: null,
        finishedAt: null,
        cost: null,
        input: { nested: [null, false, 0, "", {}, [], "中文 ∑𝑥", { x: -1.25 }] },
        result: null,
        events: [],
      },
    ],
  };
  expect(decodeAiProgress(encodeAiProgress(snapshot))).toEqual(snapshot);
  expect(decodeAiProgress(encodeAiProgress({ models: [], jobs: [] }))).toEqual({
    models: [],
    jobs: [],
  });
});

it.each(["!invalid!", "////"])("rejects malformed payloads: %s", (data) => {
  expect(() => decodeAiProgress(data)).toThrow();
});

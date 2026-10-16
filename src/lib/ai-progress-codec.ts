import { Root, util } from "protobufjs/light";
import schema from "@/contracts/ai-progress.schema.json";
import type { AiProgressSnapshot } from "@/contracts/ai-progress";

const snapshotType = Root.fromJSON(schema).lookupType("ohmypaper.ai.ProgressSnapshot");
type Value = {
  nullValue?: number;
  numberValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  structValue?: { fields?: Record<string, Value> };
  listValue?: { values?: Value[] };
};

function toValue(value: unknown): Value {
  if (value === null || value === undefined) return { nullValue: 0 };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map(toValue) } };
  if (typeof value === "object")
    return {
      structValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, toValue(item)]),
        ),
      },
    };
  throw new Error("AI 进度包含无法编码的值。");
}

function fromValue(value: Value): unknown {
  if (value.nullValue !== undefined) return null;
  if (value.numberValue !== undefined) return value.numberValue;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.listValue) return (value.listValue.values ?? []).map(fromValue);
  if (value.structValue)
    return Object.fromEntries(
      Object.entries(value.structValue.fields ?? {}).map(([key, item]) => [key, fromValue(item)]),
    );
  throw new Error("AI 进度包含无效的 Protobuf Value。");
}

/** SSE is UTF-8 text; base64 carries the actual Protobuf wire bytes. */
export function encodeAiProgress(snapshot: AiProgressSnapshot): string {
  const message = snapshotType.fromObject({
    ...snapshot,
    ...(snapshot.searchConfiguration
      ? { searchConfiguration: toValue(snapshot.searchConfiguration) }
      : {}),
    jobs: snapshot.jobs.map((job) => ({
      ...job,
      input: toValue(job.input),
      result: toValue(job.result),
      cost: toValue(job.cost),
      events: job.events.map(toValue),
      ...(job.practice ? { practice: toValue(job.practice) } : {}),
    })),
  });
  const bytes = snapshotType.encode(message).finish();
  return util.base64.encode(bytes, 0, bytes.length);
}

export function decodeAiProgress(data: string): AiProgressSnapshot {
  if (data && !util.base64.test(data)) throw new Error("AI 进度不是有效的 Base64。");
  const bytes = new Uint8Array(util.base64.length(data));
  util.base64.decode(data, bytes, 0);
  const decoded = snapshotType.toObject(snapshotType.decode(bytes), { arrays: true }) as {
    searchConfiguration?: Value;
    models: AiProgressSnapshot["models"];
    jobs: (Omit<
      AiProgressSnapshot["jobs"][number],
      "input" | "result" | "cost" | "events" | "practice"
    > & {
      input: Value;
      result: Value;
      cost: Value;
      events: Value[];
      practice?: Value;
    })[];
  };
  return {
    ...(decoded.searchConfiguration
      ? {
          searchConfiguration: fromValue(
            decoded.searchConfiguration,
          ) as AiProgressSnapshot["searchConfiguration"],
        }
      : {}),
    models: decoded.models,
    jobs: decoded.jobs.map(({ practice, ...job }) => ({
      ...job,
      attempts: job.attempts ?? 0,
      error: job.error ?? null,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      input: fromValue(job.input),
      result: fromValue(job.result),
      cost: fromValue(job.cost) as AiProgressSnapshot["jobs"][number]["cost"],
      events: job.events.map(fromValue),
      ...(practice
        ? { practice: fromValue(practice) as AiProgressSnapshot["jobs"][number]["practice"] }
        : {}),
    })),
  };
}

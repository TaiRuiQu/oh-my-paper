import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  Type,
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { projectXiaozhiView } from "@/server/xiaozhi/view";

describe("小纸 Pi Durable harness", () => {
  it("compacts old model context while retaining the visible conversation history", async () => {
    const faux = fauxProvider({
      models: [{ id: "compact-test", contextWindow: 100000, maxTokens: 1000 }],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const harness = await Harness.open(
      new MemoryStorage(),
      {
        models,
        registry: createRegistry(),
        settings: {
          compaction: { reserveTokens: 1000, keepRecentTokens: 300, backgroundTokens: 0 },
        },
      },
      context,
    );
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } },
      });
      faux.setResponses(
        Array.from({ length: 4 }, (_, index) =>
          fauxAssistantMessage(`第 ${index} 次回复。${"已读取资料。".repeat(200)}`),
        ),
      );
      for (let index = 0; index < 4; index++)
        await (
          await root.submit(
            { type: "input", content: `第 ${index} 次任务：${"复习知识点。".repeat(200)}` },
            context,
          )
        ).wait(context);
      const watch = await root.watch(context);
      const visibleBefore = projectXiaozhiView(watch.value);
      expect(visibleBefore.messages).toHaveLength(8);
      faux.setResponses([
        fauxAssistantMessage("已完成四次复习任务，需要保留这些学习结论并继续后续操作。"),
      ]);
      const taskId = await root.compact("保留已完成的任务和用户要求", context);
      const settled = await harness.waitForTask(taskId, context);
      expect(settled.state.outcome.status).toBe("completed");
      if (settled.state.outcome.status === "completed" && settled.state.outcome.result.submissionId)
        await (await harness.submission(settled.state.outcome.result.submissionId, context))!.wait(
          context,
        );
      const after = projectXiaozhiView(watch.value, visibleBefore);
      expect(after.messages).toHaveLength(8);
      expect((await root.context(context)).head?.kind).toBe("pi.compaction");
      await watch.stop();
    } finally {
      await harness.close(context);
    }
  }, 10000);

  it("completes a long autonomous tool loop and projects real tool outcomes", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    let calls = 0;
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "website",
        tools: [
          defineTool({
            name: "read",
            description: "Read the next page",
            parameters: Type.Object({ page: Type.Number() }),
            replay: "safe",
            execute: async ({ page }) => {
              calls++;
              return { output: [{ type: "text", text: JSON.stringify({ page }) }] };
            },
          }),
        ],
      }),
    );
    faux.setResponses([
      ...Array.from({ length: 35 }, (_, page) =>
        fauxAssistantMessage(fauxToolCall("read", { page }, { id: `read-${page}` }), {
          stopReason: "toolUse",
        }),
      ),
      fauxAssistantMessage("已检查全部 35 页。"),
    ]);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } },
      });
      const input = await root.submit(
        {
          type: "input",
          content: "检查全部页面",
          requestId: "first",
          entry: { kind: "xiaozhi.user", data: { messageId: "user-message" } },
        },
        context,
      );
      expect((await input.wait(context)).status).toBe("done");
      expect(calls).toBe(35);
      const watch = await root.watch(context);
      const view = projectXiaozhiView(watch.value);
      expect(view.busy).toBe(false);
      expect(view.messages[0].id).toBe("user-message");
      expect(
        view.messages
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "tool" && part.state === "completed"),
      ).toHaveLength(35);
      expect(view.messages.at(-1)?.parts).toContainEqual({
        type: "text",
        text: "已检查全部 35 页。",
      });
      await watch.stop();
    } finally {
      await harness.close(context);
    }
  }, 15000);

  it("recovers an interrupted run from disk without repeating an unsafe website mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiaozhi-recovery-"));
    const path = join(directory, "session.sqlite");
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    let writes = 0;
    let started!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "website",
        tools: [
          defineTool({
            name: "save",
            description: "Persist a paper",
            parameters: Type.Object({}),
            replay: "unsafe",
            execute: async (_args, _api, invocation) => {
              writes++;
              started();
              await new Promise<void>((_resolve, reject) => {
                if (invocation.abortSignal?.aborted) reject(new Error("interrupted"));
                invocation.abortSignal?.addEventListener(
                  "abort",
                  () => reject(new Error("interrupted")),
                  { once: true },
                );
              });
              return {};
            },
          }),
        ],
      }),
    );
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("save", {}, { id: "save-once" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("操作中断，先核实已保存内容。"),
    ]);
    let harness = await Harness.open(
      await openNodeSqliteStorage(path),
      { models, registry },
      context,
    );
    try {
      let root = await harness.root(context, {
        agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } },
      });
      const first = await root.submit(
        { type: "input", content: "保存试卷", requestId: "durable-input" },
        context,
      );
      await toolStarted;
      await harness.close(context);
      expect(writes).toBe(1);
      harness = await Harness.open(
        await openNodeSqliteStorage(path),
        { models, registry },
        context,
      );
      root = await harness.root(context);
      const duplicate = await root.submit(
        { type: "input", content: "保存试卷", requestId: "durable-input" },
        context,
      );
      expect(duplicate.id).toBe(first.id);
      harness.resume();
      expect((await duplicate.wait(context)).status).toBe("done");
      expect(writes).toBe(1);
      const history = await root.context(context);
      expect(
        history.messages.some((message) => message.role === "toolResult" && message.isError),
      ).toBe(true);
    } finally {
      await harness.close(context);
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);

  it("accepts steering while a tool is running and stops without cancelling the UI subscription", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    let started!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "wait",
        tools: [
          defineTool({
            name: "wait",
            description: "Wait",
            parameters: Type.Object({}),
            replay: "safe",
            execute: async (_args, _api, invocation) => {
              started();
              await new Promise<void>((_resolve, reject) =>
                invocation.abortSignal?.addEventListener(
                  "abort",
                  () => reject(new Error("stopped")),
                  { once: true },
                ),
              );
              return {};
            },
          }),
        ],
      }),
    );
    faux.setResponses([fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" })]);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } },
      });
      await root.submit({ type: "input", content: "开始任务" }, context);
      await toolStarted;
      const steer = await root.submit(
        { type: "input", content: "修改为另一个班级", whenBusy: "steer" },
        context,
      );
      expect((await steer.status(context)).status).toBe("queued");
      await root.abort(context, { background: true });
      expect((await steer.status(context)).status).toBe("unanswered");
      const watch = await root.watch(context);
      expect(projectXiaozhiView(watch.value).busy).toBe(false);
      await watch.stop();
    } finally {
      await harness.close(context);
    }
  }, 10000);
});

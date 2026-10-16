import { describe, expect, it } from "vitest";
import type { ConversationView } from "@earendil-works/pi-durable";
import type { XiaozhiMessage } from "@/contracts/xiaozhi";
import { xiaozhiMessageSchema } from "@/contracts/xiaozhi";
import { projectXiaozhiView } from "@/server/xiaozhi/view";
import { groupXiaozhiMessages, splitXiaozhiReply } from "@/lib/xiaozhi-transcript";

describe("小纸对话展示", () => {
  it("uses original user parts instead of the model's private attachment context", () => {
    const message = {
      id: "input",
      role: "user",
      parts: [
        { type: "text", text: "  请导入试卷\n" },
        {
          type: "file",
          url: "/api/platform/assets/11111111-1111-1111-1111-111111111111",
          filename: "原卷.pdf",
          mediaType: "application/pdf",
        },
      ],
    };
    const view = projectXiaozhiView({
      entries: [
        {
          id: "entry",
          kind: "xiaozhi.user",
          data: { messageId: message.id, message },
          model: [
            {
              role: "user",
              content: [
                { type: "text", text: "请导入试卷" },
                { type: "text", text: "附件清单（内部上下文）assetUrl=/secret" },
              ],
            },
          ],
        },
      ],
      docs: {},
    } as unknown as ConversationView);
    expect(view.messages).toEqual([
      {
        id: "input",
        role: "user",
        parts: [
          message.parts[0],
          {
            type: "file",
            url: message.parts[1].url,
            name: "原卷.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("内部上下文");
    expect(JSON.stringify(view)).not.toContain("assetUrl");
  });
  it("groups tool iterations into one process and retains only the final reply as the copy target", () => {
    const messages: XiaozhiMessage[] = [
      { id: "user", role: "user", parts: [{ type: "text", text: "开始" }] },
      {
        id: "step1",
        role: "assistant",
        parts: [
          { type: "thinking", text: "计划" },
          { type: "text", text: "先查看文件" },
          { type: "tool", id: "tool", name: "sandbox", input: {}, state: "completed" },
        ],
      },
      {
        id: "step2",
        role: "assistant",
        parts: [
          { type: "thinking", text: "核对完成" },
          { type: "text", text: "已导入全部题目" },
        ],
      },
      { id: "user2", role: "user", parts: [{ type: "text", text: "继续" }] },
    ];
    const groups = groupXiaozhiMessages(messages);
    expect(groups).toHaveLength(3);
    const split = splitXiaozhiReply(groups[1].messages);
    expect(split.reply).toEqual([{ type: "text", text: "已导入全部题目" }]);
    expect(split.process).toHaveLength(4);
    expect(splitXiaozhiReply([messages[1]]).reply).toEqual([]);
  });
  it("keeps a new streaming response after the committed iterations", () => {
    const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
    const view = projectXiaozhiView(
      {
        entries: [{ id: "committed", kind: "pi.assistant", model: [assistant("已查看材料")] }],
        docs: { "pi.live": { generation: { message: assistant("最终回复") } } },
      } as unknown as ConversationView,
      {
        messages: [
          { id: "streaming", role: "assistant", parts: [{ type: "text", text: "旧流式内容" }] },
        ],
        busy: true,
        compacting: false,
        retrying: false,
      },
    );
    expect(view.messages.map((message) => message.id)).toEqual(["committed", "streaming"]);
  });
  it("allows original PDF media types and limits attachments by file count", () => {
    const file = {
      type: "file",
      mediaType: "application/pdf",
      url: "/api/platform/assets/11111111-1111-1111-1111-111111111111",
    };
    expect(
      xiaozhiMessageSchema.safeParse({ id: "x", role: "user", parts: Array(20).fill(file) })
        .success,
    ).toBe(true);
    expect(
      xiaozhiMessageSchema.safeParse({ id: "x", role: "user", parts: Array(21).fill(file) })
        .success,
    ).toBe(false);
  });
});

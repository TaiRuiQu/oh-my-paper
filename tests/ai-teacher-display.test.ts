import { describe, expect, it } from "vitest";
import { aiActivityImages, aiTeacherActivity, aiTeacherFailure } from "@/lib/ai-teacher-display";
import { aiToolLabel, aiTraceActivities } from "@/lib/ai-trace-display";

const activity = (error: unknown) =>
  aiTraceActivities([{ type: "tool", name: "read_question", status: "ended", error }])[0];

describe("teacher-friendly AI explanations", () => {
  it("explains invalid calls according to the task's current state without technical details", () => {
    const invalid = activity(
      JSON.stringify({
        name: "AI_InvalidToolInputError",
        message: "items[0].questionId: invalid input",
        code: "SCHEMA_ERROR",
      }),
    );
    expect(aiTeacherActivity(invalid, "RUNNING")).toBe(
      "AI 需要调整处理方式。AI 正在继续核对，您可以先等待处理结果。",
    );
    expect(aiTeacherActivity(invalid, "COMPLETED")).toBe(
      "AI 需要调整处理方式。AI 已继续处理，请以最终保存的结果为准。",
    );
    expect(aiTeacherActivity(invalid, "FAILED")).toContain("本次处理已停止");
  });
  it("does not ask the teacher to retry an earlier error after the task has completed", () => {
    const timeout = activity("HTTP 504: upstream timed out");
    const explanation = aiTeacherActivity(timeout, "COMPLETED");
    expect(explanation).toContain("已继续处理");
    expect(explanation).not.toMatch(/重试|HTTP|504|upstream/);
  });
  it.each([
    ["答题区域超出纸张边界", "请检查试卷题目后重新生成"],
    ["题目已被修改", "请使用最新内容重新提交"],
    ["Credit 余额为负", "请联系管理员补充额度"],
    ["APICallError HTTP 401", "请联系管理员检查 AI 服务配置"],
    ["HTTP 503 Service Unavailable", "请稍后重试"],
    ["TypeError: Cannot read properties of undefined", "这次处理没有完成"],
  ])("provides a practical next action for %s", (error, expected) => {
    const explanation = aiTeacherFailure(error);
    expect(explanation).toContain(expected);
    expect(explanation).not.toMatch(/HTTP|APICallError|TypeError|undefined|Credit/);
  });
  it("uses task language for computing tools and unknown tool names", () => {
    expect(aiToolLabel("python")).toBe("核对材料与计算");
    expect(aiToolLabel("shell")).toBe("核对材料与计算");
    expect(aiToolLabel("internal_plugin_v2")).toBe("处理题目");
  });
  it("keeps useful authorized image results while ignoring paths, filenames and unrelated text", () => {
    const [item] = aiTraceActivities([
      { type: "tool", name: "python", status: "ended", toolCallId: "image" },
      {
        type: "sandbox",
        name: "python",
        toolCallId: "image",
        images: [
          { name: "crop.png", url: "/api/platform/assets/page1" },
          { name: "private.png", url: "https://example.test/remote" },
        ],
        stdout: "/workspace/output/crop.png",
        exitCode: 0,
      },
    ]);
    expect(aiActivityImages(item)).toEqual(["/api/platform/assets/page1"]);
  });
});

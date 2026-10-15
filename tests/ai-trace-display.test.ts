import { describe, expect, it } from "vitest";
import {
  aiJobCurrentStep,
  aiJobElapsed,
  aiTraceActivities,
  aiTraceGroups,
  formatAIDuration,
  normalizeAITraceText,
} from "@/lib/ai-trace-display";
import { aiTraceFixtures } from "./fixtures/ai-traces";

describe("compact AI execution logs", () => {
  it("merges consecutive tools across rounds while preserving call order and final checks", () => {
    const job = aiTraceFixtures.find((fixture) => fixture.id === "trace-import-rich")!;
    const activities = aiTraceActivities(job.events);
    const groups = aiTraceGroups(activities);
    expect(groups.map((group) => group.label)).toEqual([
      "开始处理任务",
      "连续工具调用",
      "核对任务结果",
      expect.any(String),
    ]);
    expect(groups[1].activities).toHaveLength(8);
    expect(groups[1].activities.filter((activity) => activity.status === "error")).toHaveLength(1);
    expect(groups.flatMap((group) => group.activities)).toEqual(activities);
    expect(aiTraceGroups(activities.slice(1, 7))[0].label).toBe("查看图片");
  });

  it("keeps model messages between tool groups", () => {
    const activities = aiTraceActivities([
      { type: "tool", name: "python", status: "ended" },
      { type: "tool", name: "shell", status: "ended" },
      { type: "message", message: "继续核对答案" },
      { type: "tool", name: "python", status: "started" },
      { type: "tool", name: "python", status: "started" },
    ]);
    expect(aiTraceGroups(activities).map((group) => group.activities.length)).toEqual([2, 1, 2]);
    expect(aiTraceGroups([])).toEqual([]);
  });

  it("decodes prose newlines and preserves formulas and literal code", () => {
    expect(
      normalizeAITraceText(String.raw`清单：\n1. $\nu+\nabla x\neq 0$\n2. **答案**\n\n说明`),
    ).toBe("清单：\n1. $\\nu+\\nabla x\\neq 0$\n2. **答案**\n\n说明");
    const protectedText = String.raw`\(\nu\neq 0\) and \[\nabla x\] and \neq and \newcommand and \nu`;
    expect(normalizeAITraceText(protectedText)).toBe(protectedText);
    expect(normalizeAITraceText('```python\nprint("\\n")\n```')).toBe(
      '```python\nprint("\\n")\n```',
    );
    expect(normalizeAITraceText('`print("\\n")`')).toBe('`print("\\n")`');
  });
  it("groups lifecycle events by call ID when identical tools finish out of order", () => {
    const job = aiTraceFixtures.find((fixture) => fixture.kind === "GRADE")!;
    const activities = aiTraceActivities(job.events);
    expect(activities).toHaveLength(3);
    expect(activities[1].durationMs).toBe(800);
    expect(activities[2].durationMs).toBe(310);
    expect(activities[1].events.map(({ index }) => index)).toEqual([1, 4]);
    expect(activities[2].events.map(({ index }) => index)).toEqual([2, 3, 5]);
    expect(aiJobCurrentStep(job, activities)).toBe("分析处理结果，确定下一步");
  });

  it("retains every raw event while merging tool, sandbox, and round diagnostics", () => {
    for (const job of aiTraceFixtures) {
      const activities = aiTraceActivities(job.events);
      const restored = activities
        .flatMap((activity) => activity.events)
        .sort((left, right) => left.index - right.index)
        .map(({ value }) => value);
      expect(restored).toEqual(job.events);
    }
    const importJob = aiTraceFixtures[0];
    const activities = aiTraceActivities(importJob.events);
    expect(activities).toHaveLength(3);
    expect(activities[1].events).toHaveLength(4);
    expect(aiJobCurrentStep(importJob, activities)).toBe("核对扫描页题目数量");
  });

  it("does not leave a completed tool as the current step or treat a recovered tool error as task failure", () => {
    const job = aiTraceFixtures[0];
    const events = [
      { type: "tool", name: "python", toolCallId: "first", status: "started" },
      { type: "tool", name: "python", toolCallId: "first", status: "ended" },
      { type: "sandbox", name: "python", toolCallId: "first", exitCode: 1 },
      { type: "step", toolNames: ["python"] },
      { type: "tool", name: "python", toolCallId: "second", status: "started" },
      { type: "tool", name: "python", toolCallId: "second", status: "ended" },
      { type: "sandbox", name: "python", toolCallId: "second", exitCode: 0 },
    ];
    const activities = aiTraceActivities(events);
    expect(activities.map((activity) => activity.status)).toEqual(["error", "complete"]);
    expect(aiJobCurrentStep({ ...job, events })).toBe("分析处理结果，确定下一步");
  });

  it("shows explicit pending, preparing, saving, and interrupted states", () => {
    const job = aiTraceFixtures[0];
    expect(aiJobCurrentStep({ ...job, events: [] })).toBe("准备处理材料");
    expect(aiJobCurrentStep({ ...job, events: [{ type: "complete" }] })).toBe("保存处理结果");
    expect(aiJobCurrentStep({ ...job, status: "QUEUED" })).toBe("等待开始处理");
    expect(aiJobCurrentStep({ ...job, status: "FAILED" })).toBe("处理已中断，可重试任务");
    expect(aiJobCurrentStep({ ...job, status: "COMPLETED" })).toBe("处理完成");
  });

  it("uses actual start and finish times and excludes queue time from execution duration", () => {
    expect(aiJobElapsed(aiTraceFixtures[1], null)).toBe("2 分 6 秒");
    expect(aiJobElapsed(aiTraceFixtures[2], Date.parse("2026-10-15T02:00:30Z"))).toBe("30 秒");
    expect(aiJobElapsed(aiTraceFixtures[0], null)).toBeNull();
    expect(aiJobElapsed(aiTraceFixtures[0], Date.parse("2026-10-15T02:00:35Z"))).toBe("30 秒");
    expect(formatAIDuration(400)).toBe("不足 1 秒");
    expect(formatAIDuration(3_700_000)).toBe("1 小时 1 分");
  });
});

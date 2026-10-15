"use client";

import { PlatformAI } from "./ai";
import { useDomain } from "./domain-provider";
import { PageHeader } from "./page-header";

export function CardAIPage({ paperId }: { paperId?: string }) {
  const { state, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title="AI 自动排版答题卡"
        description="选择已保存的试卷，AI 会阅读题目、分配作答空间并检查每页版面。完成后可进入制作页核对与调整。"
        back={{ href: "/exams/cards", label: "全部答题卡" }}
      />
      <PlatformAI
        state={state}
        tab="templates"
        initialPaperId={paperId}
        refresh={refresh}
        notify={notify}
      />
    </>
  );
}

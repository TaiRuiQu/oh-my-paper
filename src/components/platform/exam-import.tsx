"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlatformAI } from "./ai";
import { useDomain } from "./domain-provider";
import { PageHeader } from "./page-header";

export function ExamImportPage() {
  const { state, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title="扫描导入试卷"
        description="上传试卷图片或 PDF，识别题目、材料与分值并创建可编辑的试卷。请按页码顺序选择文件，完成后核对试卷内容和参考答案。"
        back={{ href: "/exams/papers", label: "全部试卷" }}
        actions={
          <Button asChild variant="outline">
            <Link href="/exams/papers/new">手动创建试卷</Link>
          </Button>
        }
      />
      <PlatformAI
        state={state}
        tab="questions"
        importKind="EXAM"
        refresh={refresh}
        notify={notify}
      />
    </>
  );
}

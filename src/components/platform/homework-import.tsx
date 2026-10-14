"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlatformAI } from "./ai";
import { useDomain } from "./domain-provider";
import { PageHeader } from "./page-header";

export function HomeworkImportPage() {
  const { state, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title="图片识别作业"
        description="上传作业图片或 PDF，AI 识别题目、材料与分值并生成练习册草稿，完成后核对内容和参考答案。"
        back={{ href: "/homework", label: "全部作业" }}
        actions={
          <Button asChild variant="outline">
            <Link href="/homework/new">手动创建作业</Link>
          </Button>
        }
      />
      <PlatformAI
        state={state}
        tab="questions"
        importKind="HOMEWORK"
        refresh={refresh}
        notify={notify}
      />
    </>
  );
}

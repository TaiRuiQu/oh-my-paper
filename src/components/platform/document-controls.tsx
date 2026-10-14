"use client";
import { useState } from "react";
import { DOCUMENT_FONTS, type BankQuestion, type DocumentLayout } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Field } from "./primitives";
import { QuestionEditor } from "./questions";
import { QuestionBankPicker } from "./question-bank-picker";
export function DocumentFormatControls({
  layout,
  onChange,
}: {
  layout: DocumentLayout;
  onChange: (value: DocumentLayout) => void;
}) {
  const names: Record<string, string> = {
    NSimSun: "新宋体",
    SimSun: "宋体",
    SimHei: "黑体",
    "Microsoft YaHei": "微软雅黑",
    "Noto Serif SC": "思源宋体",
  };
  return (
    <>
      <Field label="方向">
        <select
          value={layout.orientation ?? "portrait"}
          onChange={(e) =>
            onChange({ ...layout, orientation: e.target.value as "portrait" | "landscape" })
          }
        >
          <option value="portrait">纵向</option>
          <option value="landscape">横向</option>
        </select>
      </Field>
      <Field label="字体">
        <select
          value={layout.fontFamily ?? "NSimSun"}
          onChange={(e) =>
            onChange({ ...layout, fontFamily: e.target.value as DocumentLayout["fontFamily"] })
          }
        >
          {DOCUMENT_FONTS.map((font) => (
            <option key={font} value={font}>
              {names[font] ?? font}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
export function DocumentInsertTools({
  subject,
  grade,
  usedIds,
  onAdd,
  onText,
}: {
  subject: string;
  grade: string;
  usedIds: string[];
  onAdd: (question: BankQuestion) => void;
  onText: () => void;
}) {
  const [bank, setBank] = useState(false),
    [create, setCreate] = useState(false);
  return (
    <div className="p-insert-tools">
      <h3>插入内容</h3>
      <p className="p-muted">直接编写题目和文字，或逐题从题库导入。</p>
      <Button type="button" onClick={() => setCreate(true)}>
        新建题目
      </Button>
      <Button type="button" variant="outline" onClick={onText}>
        添加文字
      </Button>
      <Button type="button" variant="outline" onClick={() => setBank(true)}>
        从题库导入一道题目
      </Button>
      <QuestionBankPicker
        open={bank}
        onOpenChange={setBank}
        subject={subject}
        usedIds={usedIds}
        onImport={onAdd}
      />
      <Sheet open={create} onOpenChange={setCreate}>
        <SheetContent className="p-bank-picker" side="right">
          <SheetHeader>
            <SheetTitle>新建文档题目</SheetTitle>
            <SheetDescription>保存在当前文档中，之后可直接在纸面编辑。</SheetDescription>
          </SheetHeader>
          {create && (
            <QuestionEditor
              question={null}
              defaults={{ subject, grade }}
              pending={false}
              close={() => setCreate(false)}
              mutate={async (command) => {
                if (command.type !== "question.save") return { error: "请选择题目" };
                const now = new Date().toISOString(),
                  id = crypto.randomUUID();
                onAdd({ ...command.question, id, ownerId: "", createdAt: now, updatedAt: now });
                return { id };
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

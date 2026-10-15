"use client";
import { useId, useState } from "react";
import { DOCUMENT_FONTS, type BankQuestion, type DocumentLayout } from "@/contracts/platform";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";
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
const READ_LOCAL_FONTS = "__read_local_fonts__";
export function DocumentFormatControls({
  layout,
  onChange,
}: {
  layout: DocumentLayout;
  onChange: (value: DocumentLayout) => void;
}) {
  const fontSelectId = useId();
  const fontFamily = layout.fontFamily ?? DOCUMENT_DEFAULTS.fontFamily;
  const commonFonts = [...new Set([...DOCUMENT_FONTS, fontFamily])];
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontMessage, setFontMessage] = useState("");
  async function loadLocalFonts() {
    const browser = window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> };
    if (!browser.queryLocalFonts) {
      setFontMessage("当前浏览器不支持读取本机字体，请从列表中选择字体。");
      return;
    }
    setFontLoading(true);
    setFontMessage("");
    try {
      const fonts = await browser.queryLocalFonts();
      setLocalFonts(
        [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b)),
      );
    } catch {
      setFontMessage("未能读取本机字体，请允许字体访问后重试，或选择常用字体。");
    } finally {
      setFontLoading(false);
    }
  }
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
      <div className="p-field">
        <label htmlFor={fontSelectId}>字体</label>
        <select
          id={fontSelectId}
          value={fontLoading ? READ_LOCAL_FONTS : fontFamily}
          disabled={fontLoading}
          aria-busy={fontLoading}
          aria-describedby={fontMessage ? `${fontSelectId}-message` : undefined}
          onChange={(e) => {
            if (e.target.value === READ_LOCAL_FONTS) {
              void loadLocalFonts();
            } else {
              onChange({ ...layout, fontFamily: e.target.value });
            }
          }}
        >
          <optgroup label="常用字体">
            {commonFonts.map((font) => (
              <option key={font} value={font}>
                {names[font] ?? font}
              </option>
            ))}
          </optgroup>
          {localFonts.some((font) => !commonFonts.includes(font)) && (
            <optgroup label="本机字体">
              {localFonts
                .filter((font) => !commonFonts.includes(font))
                .map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
            </optgroup>
          )}
          <option value={READ_LOCAL_FONTS}>
            {fontLoading ? "正在读取本机字体…" : "读取本机字体…"}
          </option>
        </select>
        {fontMessage && (
          <small id={`${fontSelectId}-message`} role="status">
            {fontMessage}
          </small>
        )}
      </div>
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

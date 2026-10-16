"use client";
import { useEffect, useRef, useState } from "react";
import type { HomeworkAnswer, HomeworkStudentPaper } from "@/contracts/homework";
import { Field } from "@/components/platform/primitives";
import { PaperReading, StudentPrompt } from "@/components/homework-collection/prompt";
import styles from "./practice.module.css";
export type PracticeLocalAnswer = HomeworkAnswer;
type Upload = { id: string; itemId: string; file: File; url?: string; error?: string };
export function PracticeAnswerEditor({
  papers,
  answers,
  onChange,
  disabled,
  upload,
  onUploading,
  onUnresolved,
}: {
  papers: HomeworkStudentPaper[];
  answers: PracticeLocalAnswer[];
  onChange: (answers: PracticeLocalAnswer[]) => void;
  disabled: boolean;
  upload: (file: File) => Promise<string>;
  onUploading: (value: boolean) => void;
  onUnresolved: (value: boolean) => void;
}) {
  const [staged, setStaged] = useState<Upload[]>([]),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    stagedRef = useRef<Upload[]>([]),
    answerRef = useRef(answers);
  useEffect(() => {
    answerRef.current = answers;
  }, [answers]);
  function put(next: Upload[]) {
    stagedRef.current = next;
    setStaged(next);
    onUnresolved(next.length > 0);
  }
  async function send(entries: Upload[]) {
    if (lock.current) return;
    lock.current = true;
    setUploading(true);
    onUploading(true);
    try {
      for (const entry of entries) {
        try {
          const url = await upload(entry.file);
          put(
            stagedRef.current.map((candidate) =>
              candidate.id === entry.id ? { ...candidate, url, error: undefined } : candidate,
            ),
          );
        } catch (cause) {
          put(
            stagedRef.current.map((candidate) =>
              candidate.id === entry.id
                ? {
                    ...candidate,
                    error: cause instanceof Error ? cause.message : "图片上传失败，请重试。",
                  }
                : candidate,
            ),
          );
        }
      }
    } finally {
      lock.current = false;
      setUploading(false);
      onUploading(false);
    }
  }
  function answer(itemId: string) {
    return answers.find((entry) => entry.itemId === itemId) ?? { itemId, text: "", images: [] };
  }
  function update(itemId: string, patch: Partial<PracticeLocalAnswer>) {
    const existing = answerRef.current.find((entry) => entry.itemId === itemId);
    onChange(
      existing
        ? answerRef.current.map((entry) =>
            entry.itemId === itemId ? { ...entry, ...patch } : entry,
          )
        : [...answerRef.current, { itemId, text: "", images: [], ...patch }],
    );
  }
  function appendUploaded(itemId: string) {
    const ready = stagedRef.current.filter((entry) => entry.itemId === itemId && entry.url);
    if (!ready.length) return;
    const current = answerRef.current.find((entry) => entry.itemId === itemId) ?? {
      itemId,
      text: "",
      images: [],
    };
    update(itemId, { images: [...current.images, ...ready.map((entry) => entry.url!)] });
    put(stagedRef.current.filter((entry) => !ready.some((done) => done.id === entry.id)));
  }
  return (
    <div className={styles.stack}>
      {error && (
        <p role="alert" className="p-notice error">
          {error}
        </p>
      )}
      {papers.map((paper, paperIndex) => (
        <section key={paper.id}>
          <h3>
            {paper.name} · {paper.subject}
          </h3>
          <PaperReading paper={paper} context={`练习第 ${paperIndex + 1} 份`} />
          {paper.items.map((item, index) => {
            const current = answer(item.id),
              uploads = staged.filter((entry) => entry.itemId === item.id);
            return (
              <section key={item.id} className={styles.section}>
                <PaperReading
                  paper={paper}
                  beforeItemId={item.id}
                  context={`练习第 ${paperIndex + 1} 份`}
                />
                <StudentPrompt item={item} index={index} context={`练习第 ${paperIndex + 1} 份`} />
                <Field
                  label={`${paper.name}第 ${index + 1} 题我的作答`}
                  hint={
                    item.parts.length
                      ? "按小问编号填写文字或上传有序作答图片。"
                      : "填写选项、过程或文字作答。"
                  }
                >
                  <textarea
                    maxLength={100000}
                    disabled={disabled || uploading}
                    value={current.text}
                    onChange={(event) => update(item.id, { text: event.target.value })}
                  />
                </Field>
                <Field
                  label={`${paper.name}第 ${index + 1} 题作答图片`}
                  hint="支持PNG、JPEG、WebP，每题最多30张；全部上传成功后再保存。"
                >
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    disabled={disabled || uploading}
                    onChange={async (event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.currentTarget.value = "";
                      if (lock.current || disabled || !files.length) return;
                      if (current.images.length + uploads.length + files.length > 30) {
                        setError("每题最多30张图片，请减少文件。");
                        return;
                      }
                      const entries = files.map((file) => ({
                        id: crypto.randomUUID(),
                        itemId: item.id,
                        file,
                      }));
                      put([...stagedRef.current, ...entries]);
                      await send(entries);
                    }}
                  />
                </Field>
                {current.images.map((url, imageIndex) => (
                  <div className={styles.row} key={`${url}/${imageIndex}`}>
                    <a href={url} target="_blank" rel="noreferrer">
                      已加入作答图 {imageIndex + 1}
                    </a>
                    <div className="p-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={disabled || uploading || imageIndex === 0}
                        onClick={() => {
                          const images = [...current.images];
                          [images[imageIndex - 1], images[imageIndex]] = [
                            images[imageIndex],
                            images[imageIndex - 1],
                          ];
                          update(item.id, { images });
                        }}
                      >
                        上移图 {imageIndex + 1}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={disabled || uploading}
                        onClick={() =>
                          update(item.id, {
                            images: current.images.filter((_, position) => position !== imageIndex),
                          })
                        }
                      >
                        移除图 {imageIndex + 1}
                      </button>
                    </div>
                  </div>
                ))}
                {uploads.map((entry, imageIndex) => (
                  <div key={entry.id} className={styles.row}>
                    <div>
                      <strong>{entry.file.name}</strong>
                      <p role={entry.error ? "alert" : "status"}>
                        {entry.error ?? (entry.url ? "上传成功，待加入本题作答" : "正在上传…")}
                      </p>
                    </div>
                    <div className="p-actions">
                      {entry.error && (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={disabled || uploading}
                          onClick={() => void send([entry])}
                        >
                          重试第 {imageIndex + 1} 张上传
                        </button>
                      )}
                      <button
                        type="button"
                        className="button secondary"
                        disabled={disabled || uploading}
                        onClick={() =>
                          put(stagedRef.current.filter((candidate) => candidate.id !== entry.id))
                        }
                      >
                        移除第 {imageIndex + 1} 张待加入图
                      </button>
                    </div>
                  </div>
                ))}
                {!!uploads.length && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled || uploading || uploads.some((entry) => !entry.url)}
                    onClick={() => appendUploaded(item.id)}
                  >
                    按上传顺序加入本题作答
                  </button>
                )}
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
}

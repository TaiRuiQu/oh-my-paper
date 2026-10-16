"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  HomeworkAnswer,
  HomeworkAssignment,
  HomeworkAssetUploadResult,
  HomeworkStudentPaper,
  HomeworkStudentWork,
} from "@/contracts/homework";
import { Field } from "@/components/platform/primitives";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { apiRequest } from "@/lib/http-client";
import { useHomework } from "./provider";
import { HomeworkPanel, collectionLabel, participationLabel } from "./primitives";
import { HomeworkHistoryView } from "./history";
import { PaperReading, StudentPrompt } from "./prompt";
import styles from "./homework.module.css";
type Upload = { id: string; itemId: string; file: File; url?: string; error?: string };
export function StudentWork({
  assignment: a,
  work,
  paper,
  onDirty,
}: {
  assignment: HomeworkAssignment;
  work: HomeworkStudentWork;
  paper: HomeworkStudentPaper;
  onDirty?: (dirty: boolean) => void;
}) {
  const { pending, stale, execute, refresh } = useHomework();
  const [answers, setAnswers] = useState<HomeworkAnswer[]>(() =>
    paper.items.map((item) =>
      structuredClone(
        work.draft.answers.find((answer) => answer.itemId === item.id) ?? {
          itemId: item.id,
          text: "",
          images: [],
        },
      ),
    ),
  );
  const [dirty, setDirty] = useState(false),
    [uploads, setUploads] = useState<Upload[]>([]),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [receipt, setReceipt] = useState("");
  useEffect(() => {
    onDirty?.(dirty || !!uploads.length);
    return () => onDirty?.(false);
  }, [dirty, uploads.length, onDirty]);
  const uploadLock = useRef(false);
  const operationLock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const { markSaved } = useUnsavedChanges(
    dirty || !!uploads.length,
    "有未保存的作业作答或图片，离开后会丢失。确定离开？",
  );
  const disabled = pending || stale || uploading || conflict;
  const unresolved = uploads.some((upload) => !upload.url);
  const combined = () =>
    answers.map((answer) => ({
      ...answer,
      images: [
        ...answer.images,
        ...uploads
          .filter((upload) => upload.itemId === answer.itemId && upload.url)
          .map((upload) => upload.url!),
      ],
    }));
  async function uploadOne(entry: Upload) {
    const body = new FormData();
    body.set("file", entry.file);
    try {
      const result = await apiRequest<HomeworkAssetUploadResult>(
        `/api/platform/homework/works/${work.id}/assets`,
        { method: "POST", body },
      );
      setUploads((current) =>
        current.map((upload) =>
          upload.id === entry.id ? { ...upload, url: result.url, error: undefined } : upload,
        ),
      );
    } catch (cause) {
      setUploads((current) =>
        current.map((upload) =>
          upload.id === entry.id
            ? {
                ...upload,
                error: cause instanceof Error ? cause.message : "图片上传失败，请重试。",
              }
            : upload,
        ),
      );
    }
  }
  async function save() {
    if (operationLock.current || disabled || unresolved || !work.capabilities.canSaveDraft) return;
    operationLock.current = true;
    setError("");
    try {
      const result = await execute({
        type: "homework.draft.save",
        workId: work.id,
        expectedVersion: work.version,
        expectedDraftVersion: work.draft.version,
        answers: combined(),
      });
      if (result.ok) {
        markSaved();
        setAnswers(combined());
        setDirty(false);
        setUploads([]);
      } else {
        setError(result.error);
        setConflict(result.conflict);
      }
    } finally {
      operationLock.current = false;
    }
  }
  async function submit() {
    if (
      operationLock.current ||
      disabled ||
      dirty ||
      uploads.length ||
      !work.capabilities.canSubmit
    )
      return;
    const blank = answers.filter((answer) => !answer.text.trim() && !answer.images.length).length;
    if (
      !window.confirm(
        `确认提交本次作业？${blank ? `有 ${blank} 题未填写作答。` : ""}提交后本次内容只读，修改需老师退回。`,
      )
    )
      return;
    operationLock.current = true;
    setError("");
    try {
      const result = await execute({
        type: "homework.submit",
        workId: work.id,
        expectedVersion: work.version,
        expectedDraftVersion: work.draft.version,
        expectedAssignmentVersion: a.version,
        expectedRosterRevision: a.rosterRevision,
        requestId: requestId.current,
      });
      if (result.ok) {
        markSaved();
        setDirty(false);
        setReceipt(`提交成功：第 ${result.result.sequence ?? "本"} 次提交。`);
      } else {
        setError(result.error);
        setConflict(result.conflict);
      }
    } finally {
      operationLock.current = false;
    }
  }
  return (
    <HomeworkPanel
      title={`${paper.name} · ${paper.subject}`}
      description="按题填写作答，可为同一道题上传多张图片。先保存草稿，再明确提交。"
    >
      <p>
        {work.participationStatus === "REQUIRED"
          ? collectionLabel[work.collectionStatus]
          : participationLabel[work.participationStatus]}{" "}
        · 截止 {work.dueLocal.replace("T", " ")} · {a.timezone}
        {work.overdue ? " · 已过截止" : ""}
      </p>
      {work.deadlineOverride && <p>个人延期原因：{work.deadlineOverride.reason}</p>}
      {work.participationReason && <p>{work.participationReason}</p>}
      {work.currentAttempt && (
        <p className="p-notice" role="status">
          服务端回执：第 {work.currentAttempt.sequence} 次提交 ·{" "}
          {new Intl.DateTimeFormat("zh-CN", {
            timeZone: a.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(work.currentAttempt.submittedAt))}{" "}
          · {work.currentAttempt.late ? "迟交" : "按时提交"}
          {work.currentAttempt.returnReason &&
            `。老师退回原因：${work.currentAttempt.returnReason}`}
        </p>
      )}
      {receipt && (
        <p role="status" className="p-notice">
          {receipt}
        </p>
      )}
      {!!work.capabilities.blockReasons.length && (
        <div className="p-notice">
          <ul>
            {work.capabilities.blockReasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="p-notice error" role="alert">
          <p>{error}</p>
          {conflict && (
            <p>资料版本已变化，本次作答仍保留。请重新读取核对，系统不会套用新版本自动提交。</p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={pending || uploading}
            onClick={async () => {
              if (
                operationLock.current ||
                ((dirty || uploads.length) &&
                  !window.confirm("重新读取会放弃本次未保存作答与图片。确定重新读取？"))
              )
                return;
              operationLock.current = true;
              try {
                await refresh();
                markSaved();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "重读失败，作答仍保留。");
              } finally {
                operationLock.current = false;
              }
            }}
          >
            放弃作答并重新读取
          </button>
        </div>
      )}
      <p className={styles.help} role="status">
        {pending
          ? "正在处理，暂时不能编辑"
          : dirty || uploads.length
            ? "有未保存的作答"
            : work.draft.version > 0
              ? `草稿已保存 · v${work.draft.version}${work.draft.updatedAt ? ` · ${new Intl.DateTimeFormat("zh-CN", { timeZone: a.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(work.draft.updatedAt))}` : ""}`
              : "尚无已保存草稿"}
      </p>
      {work.collectionStatus === "RETURNED" && work.capabilities.canSaveDraft && (
        <p className="p-notice">
          老师已退回，请在以下草稿中修改并重新保存、提交。历史轮次继续保留。
        </p>
      )}
      <PaperReading paper={paper} />
      <form
        className="p-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className={styles.formFields} disabled={disabled}>
          {paper.items.map((item, index) => {
            const answer = answers.find((entry) => entry.itemId === item.id)!;
            const staged = uploads.filter((upload) => upload.itemId === item.id);
            return (
              <section key={item.id}>
                <PaperReading paper={paper} beforeItemId={item.id} />
                <StudentPrompt item={item} index={index} />
                {work.capabilities.canSaveDraft ? (
                  <>
                    <Field
                      label={`第 ${index + 1} 题我的作答`}
                      hint={
                        item.type === "MIXED"
                          ? "请按小问编号填写，也可上传分步作答图片。"
                          : "可填写选项、计算过程或文字答案。"
                      }
                    >
                      <textarea
                        maxLength={100000}
                        value={answer.text}
                        onChange={(event) => {
                          setAnswers((current) =>
                            current.map((entry) =>
                              entry.itemId === item.id
                                ? { ...entry, text: event.target.value }
                                : entry,
                            ),
                          );
                          setDirty(true);
                        }}
                      />
                    </Field>
                    <Field
                      label={`第 ${index + 1} 题上传作答图片`}
                      hint="支持 PNG、JPEG、WebP；每题最多 30 张，按下方顺序阅读。"
                    >
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        disabled={disabled || !work.capabilities.canUpload}
                        onChange={async (event) => {
                          const files = Array.from(event.target.files ?? []);
                          event.currentTarget.value = "";
                          if (
                            !files.length ||
                            disabled ||
                            uploadLock.current ||
                            !work.capabilities.canUpload
                          )
                            return;
                          if (answer.images.length + staged.length + files.length > 30) {
                            setError("每道题最多 30 张作答图片，请减少文件。");
                            return;
                          }
                          const entries = files.map((file) => ({
                            id: crypto.randomUUID(),
                            itemId: item.id,
                            file,
                          }));
                          uploadLock.current = true;
                          setUploads((current) => [...current, ...entries]);
                          setDirty(true);
                          setUploading(true);
                          try {
                            for (const entry of entries) await uploadOne(entry);
                          } finally {
                            uploadLock.current = false;
                            setUploading(false);
                          }
                        }}
                      />
                    </Field>
                    {answer.images.map((url, imageIndex) => (
                      <div key={url} className={styles.row}>
                        <a href={url} target="_blank" rel="noreferrer">
                          查看已保存作答图 {imageIndex + 1}
                        </a>
                        <div className="p-actions">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={disabled || imageIndex === 0}
                            onClick={() => {
                              const images = [...answer.images];
                              [images[imageIndex - 1], images[imageIndex]] = [
                                images[imageIndex],
                                images[imageIndex - 1],
                              ];
                              setAnswers((current) =>
                                current.map((entry) =>
                                  entry.itemId === item.id ? { ...entry, images } : entry,
                                ),
                              );
                              setDirty(true);
                            }}
                          >
                            上移已保存图 {imageIndex + 1}
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={disabled}
                            onClick={() => {
                              setAnswers((current) =>
                                current.map((entry) =>
                                  entry.itemId === item.id
                                    ? {
                                        ...entry,
                                        images: entry.images.filter((image) => image !== url),
                                      }
                                    : entry,
                                ),
                              );
                              setDirty(true);
                            }}
                          >
                            移除已保存图 {imageIndex + 1}
                          </button>
                        </div>
                      </div>
                    ))}
                    {staged.map((upload, imageIndex) => (
                      <div className={styles.row} key={upload.id}>
                        <div>
                          <strong>
                            新增作答图 {imageIndex + 1} · {upload.file.name}
                          </strong>
                          {upload.url ? (
                            <p>
                              <a href={upload.url} target="_blank" rel="noreferrer">
                                查看已上传原图
                              </a>
                            </p>
                          ) : (
                            <p role={upload.error ? "alert" : "status"}>
                              {upload.error || "等待上传完成…"}
                            </p>
                          )}
                        </div>
                        <div className="p-actions">
                          {upload.error && (
                            <button
                              type="button"
                              className="button secondary"
                              disabled={disabled}
                              onClick={async () => {
                                if (uploadLock.current) return;
                                uploadLock.current = true;
                                setUploading(true);
                                try {
                                  await uploadOne(upload);
                                } finally {
                                  uploadLock.current = false;
                                  setUploading(false);
                                }
                              }}
                            >
                              重试上传 {imageIndex + 1}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button secondary"
                            disabled={disabled || imageIndex === 0}
                            onClick={() =>
                              setUploads((current) => {
                                const next = [...current],
                                  before = next.findLastIndex(
                                    (entry, position) =>
                                      position <
                                        next.findIndex((entry) => entry.id === upload.id) &&
                                      entry.itemId === item.id,
                                  ),
                                  at = next.findIndex((entry) => entry.id === upload.id);
                                if (before >= 0)
                                  [next[before], next[at]] = [next[at], next[before]];
                                return next;
                              })
                            }
                          >
                            上移新增图 {imageIndex + 1}
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={disabled}
                            onClick={() =>
                              setUploads((current) =>
                                current.filter((entry) => entry.id !== upload.id),
                              )
                            }
                          >
                            移除新增图 {imageIndex + 1}
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className={styles.help}>当前作答只读。提交内容请从下方历史查看。</p>
                )}
              </section>
            );
          })}
          <div className="p-actions">
            {work.capabilities.canSaveDraft && (
              <button type="submit" className="button secondary" disabled={disabled || unresolved}>
                {pending ? "正在保存…" : "保存本人作答草稿"}
              </button>
            )}
            {work.capabilities.canSubmit && (
              <button
                type="button"
                className="button"
                disabled={disabled || dirty || !!uploads.length}
                onClick={() => void submit()}
              >
                确认提交本次作业
              </button>
            )}
          </div>
        </fieldset>
      </form>
      {dirty && (
        <p className={styles.help}>提交前请先保存全部作答。上传失败的图片须重试或明确移除。</p>
      )}
      {a.resultsPublished && (
        <p>
          <Link className="button secondary" href={`/learning/results/${a.assessmentId}`}>
            查看老师已发布的完整反馈
          </Link>
        </p>
      )}
      {work.capabilities.canViewAttemptHistory && (
        <section className={styles.section}>
          <h3>本人提交与退回历史</h3>
          <HomeworkHistoryView assignmentId={a.id} workId={work.id} timezone={a.timezone} />
        </section>
      )}
    </HomeworkPanel>
  );
}

"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type {
  PracticeAttemptDetail,
  PracticeEvaluationInput,
  PracticeSetDetail,
  PracticeSetPreview,
  PracticeStudentPaper,
} from "@/contracts/practice";
import { Field } from "@/components/platform/primitives";
import { selectedPromptText } from "@/components/homework-collection/prompt";
import { PracticeImageChoices } from "./image-choices";
import { PracticePaper } from "./paper";
import { PracticeForm, PracticePanel } from "./primitives";
import { PracticeAttemptReading, PracticeEvaluationEditor, initialEvaluation } from "./feedback";
import { usePractice } from "./provider";
import styles from "./practice.module.css";
export function PublishPractice({ preview }: { preview: PracticeSetPreview }) {
  const { pending, stale } = usePractice<PracticeSetPreview>();
  const [name, setName] = useState(preview.paper.name),
    [classroomId, setClassroomId] = useState(preview.classrooms[0]?.id ?? ""),
    [choices, setChoices] = useState<Record<string, string[]>>({}),
    [confirmed, setConfirmed] = useState(false),
    [createdId, setCreatedId] = useState("");
  const publication = useRef<{ signature: string; requestId: string } | null>(null);
  const selected = choices.paper ?? [];
  const safe: PracticeStudentPaper = {
    ...preview.studentPaper,
    instructions: selectedPromptText(preview.paper.instructions, selected),
    studentImageUrls: selected,
    textBlocks: (preview.paper.layout.textBlocks ?? []).map((block) => ({
      id: block.id,
      text: selectedPromptText(block.text, selected),
      beforeQuestionId:
        preview.paper.items.find((item) => item.questionId === block.beforeQuestionId)?.id ??
        block.beforeQuestionId,
    })),
    items: preview.studentPaper.items.map((item) => {
      const original = preview.paper.items.find((entry) => entry.id === item.id)!,
        urls = choices[item.id] ?? [];
      return {
        ...item,
        stem: selectedPromptText(original.snapshot.content.stem, urls),
        options: original.snapshot.content.options.map((option) => ({
          ...option,
          text: selectedPromptText(option.text, urls),
        })),
        parts: item.parts.map((part) => {
          const source = original.snapshot.content.parts.find((entry) => entry.id === part.id)!;
          return {
            ...part,
            stem: selectedPromptText(source.stem, urls),
            options: source.options.map((option) => ({
              ...option,
              text: selectedPromptText(option.text, urls),
            })),
          };
        }),
        studentImageUrls: urls,
      };
    }),
  };
  return (
    <PracticePanel
      title="发布独立练习"
      description="发布自有题本到授权班级；题目与图片按本次内容冻结，学生草稿保持私有。"
    >
      {preview.blockReasons.map((reason, index) => (
        <p className="p-notice" key={index}>
          {reason}
        </p>
      ))}
      {createdId ? (
        <p role="status">
          练习已发布。<Link href={`/homework/practice/${createdId}`}>打开已发布练习</Link>
          ，无需再次发布。
        </p>
      ) : (
        <PracticeForm
          label="确认发布独立练习"
          allowed={preview.canPublish && !pending && !stale}
          submitDisabled={!confirmed || !classroomId}
          dirty={!!Object.keys(choices).length || confirmed || name !== preview.paper.name}
          command={() => {
            const input = {
              type: "practice.set.publish" as const,
              paperId: preview.paper.id,
              classroomId,
              expectedPaperUpdatedAt: preview.paper.updatedAt,
              name: name.trim(),
              studentImageUrls: selected,
              items: preview.paper.items.map((item) => ({
                itemId: item.id,
                studentImageUrls: choices[item.id] ?? [],
              })),
            };
            const signature = JSON.stringify(input);
            if (!publication.current || publication.current.signature !== signature)
              publication.current = { signature, requestId: crypto.randomUUID() };
            return { ...input, requestId: publication.current.requestId };
          }}
          onSaved={(result) => setCreatedId(result.setId ?? result.id)}
        >
          <Field label="练习名称">
            <input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="发放班级">
            <select
              required
              value={classroomId}
              onChange={(event) => setClassroomId(event.target.value)}
            >
              {!preview.classrooms.length && <option value="">暂无当前授权班级</option>}
              {preview.classrooms.map((classroom) => (
                <option value={classroom.id} key={classroom.id}>
                  {classroom.name} · {classroom.stage} · {classroom.cohort}
                </option>
              ))}
            </select>
          </Field>
          <PracticeImageChoices
            label="纸级共享材料"
            urls={preview.allowedStudentImageUrls}
            selected={selected}
            onChange={(value) => {
              setChoices((current) => ({ ...current, paper: value }));
              setConfirmed(false);
            }}
          />
          {preview.items.map((item, index) => (
            <PracticeImageChoices
              key={item.itemId}
              label={`第 ${index + 1} 题题面`}
              urls={item.allowedStudentImageUrls}
              selected={choices[item.itemId] ?? []}
              onChange={(value) => {
                setChoices((current) => ({ ...current, [item.itemId]: value }));
                setConfirmed(false);
              }}
            />
          ))}
          <details>
            <summary>核对完整学生题面预览</summary>
            <PracticePaper paper={safe} context="发布前学生预览" />
          </details>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            我已预览完整题面和全部所选图片，确认没有把参考答案作为题面发放
          </label>
        </PracticeForm>
      )}
    </PracticePanel>
  );
}
export function TeacherPracticeSet({ detail }: { detail: PracticeSetDetail }) {
  const [closing, setClosing] = useState(false),
    [reason, setReason] = useState("");
  const { pending, stale, refresh } = usePractice<PracticeSetDetail>();
  const [error, setError] = useState("");
  return (
    <>
      <PracticePanel
        title={detail.set.name}
        description="练习内容按发布时冻结。关闭后停止新领取，已有学生提交与核验历史保留。"
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (closing && !window.confirm("重新读取会放弃当前关闭原因。确定重新读取？")) return;
              try {
                await refresh();
                setClosing(false);
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，输入仍保留。");
              }
            }}
          >
            重新读取发布状态
          </button>
        }
      >
        <p>
          {detail.set.classroomName} · {detail.set.subject} ·{" "}
          {detail.set.status === "OPEN" ? "开放领取" : "已关闭领取"} · 版本 v{detail.set.version}
        </p>
        {error && (
          <p className="p-notice error" role="alert">
            {error}
          </p>
        )}
        {detail.set.blockReasons.map((block, index) => (
          <p className={styles.help} key={index}>
            {block}
          </p>
        ))}
        {detail.set.canClose && !closing && (
          <button
            type="button"
            className="button secondary"
            disabled={pending || stale}
            onClick={() => setClosing(true)}
          >
            关闭新领取
          </button>
        )}
        {closing && (
          <PracticeForm
            label="确认关闭新领取"
            close={() => setClosing(false)}
            command={() => ({
              type: "practice.set.close",
              setId: detail.set.id,
              expectedVersion: detail.set.version,
              reason,
            })}
          >
            <Field label="关闭原因">
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </PracticeForm>
        )}
        <p>
          <Link href="/homework/practice">返回发布与核验队列</Link>
        </p>
      </PracticePanel>
      <PracticePanel title="已发布学生题面">
        <PracticePaper paper={detail.studentPaper} context="已发布题面" />
      </PracticePanel>
    </>
  );
}
export function TeacherPracticeReview({ detail }: { detail: PracticeAttemptDetail }) {
  const latest = [...detail.evaluations]
    .sort((a, b) => b.version - a.version)
    .find((entry) => entry.source === "TEACHER_CONFIRMED" || entry.source === "AI_CANDIDATE");
  const [evaluationDirty, setEvaluationDirty] = useState(false);
  const [evaluation, setEvaluation] = useState<PracticeEvaluationInput>(() =>
      initialEvaluation(detail.papers),
    ),
    [candidateId, setCandidateId] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const { pending, stale, refresh } = usePractice<PracticeAttemptDetail>();
  const [error, setError] = useState("");
  return (
    <>
      <PracticePanel
        title={`${detail.session.student.name} · 第 ${detail.attempt.sequence} 次练习核验`}
        description="仅核对不可变提交，不读取学生当前私人草稿；确认记录与自评、AI候选分开保存。"
      >
        <p>
          {detail.session.student.classroomName} · {detail.session.student.studentNumber} ·{" "}
          {detail.session.name}
        </p>
        {detail.attempt.blockReasons.map((block, index) => (
          <p className={styles.help} key={index}>
            {block}
          </p>
        ))}
        <PracticeAttemptReading detail={detail} context="教师核验本轮" />
        {error && (
          <p className="p-notice error" role="alert">
            {error}
          </p>
        )}
        <p>
          <Link href="/homework/practice">返回核验队列</Link>
        </p>
      </PracticePanel>
      {detail.attempt.canConfirmReview ? (
        <PracticePanel
          title="人工核验记录"
          description="逐题与逐小问核对；看不清必须标明原因，不用零分代替。历史确认和更正均保留。"
        >
          {latest && (
            <button
              type="button"
              className="button secondary"
              disabled={pending || stale}
              onClick={() => {
                if (
                  (evaluationDirty ||
                    reason ||
                    evaluation.summary ||
                    evaluation.items.some(
                      (entry) => entry.feedback || entry.parts.some((part) => part.feedback),
                    )) &&
                  !window.confirm("采用现有候选将替换当前未保存核验输入。确定采用？")
                )
                  return;
                setEvaluation(structuredClone(latest.evaluation));
                setCandidateId(latest.source === "AI_CANDIDATE" ? latest.id : null);
                setEvaluationDirty(true);
              }}
            >
              载入{latest.source === "AI_CANDIDATE" ? "AI候选" : "上次核验"}到可编辑表单
            </button>
          )}
          <PracticeForm
            label="保存教师核验记录"
            dirty={evaluationDirty || !!reason || candidateId !== null}
            command={() => ({
              type: "practice.review.confirm",
              attemptId: detail.attempt.id,
              expectedEvaluationVersion: detail.attempt.evaluationVersion,
              candidateId,
              evaluation,
              reason,
            })}
          >
            <PracticeEvaluationEditor
              papers={detail.papers}
              value={evaluation}
              onChange={(value) => {
                setEvaluation(value);
                setEvaluationDirty(true);
              }}
            />
            <Field label="核验或更正原因">
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </PracticeForm>
        </PracticePanel>
      ) : (
        <PracticePanel title="当前仅可读取提交记录">
          <p>当前权限不允许核验这份提交，请联系当前班级学科教师或管理员。</p>
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              try {
                await refresh();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
              }
            }}
          >
            重新读取当前权限
          </button>
        </PracticePanel>
      )}
    </>
  );
}

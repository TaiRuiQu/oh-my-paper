"use client";
import { useState } from "react";
import { teachingPlanSchema, type TeachingPlan, type TeachingSession } from "@/contracts/teaching";
import { Field } from "@/components/platform/primitives";
import { MarkdownText } from "@/components/markdown-text";
import { QuestionBankPicker } from "@/components/platform/question-bank-picker";
import { apiRequest } from "@/lib/http-client";
import { useTeaching } from "./provider";
import { TeachingActionForm } from "./action-form";
import { TeachingQuestionMaterial } from "./question-material";
import styles from "./teaching.module.css";

export const blankPlan = (): TeachingPlan => ({
  title: "",
  objectives: "",
  keyPoints: "",
  difficulties: "",
  activities: [],
  materials: [],
  boardPlan: "",
  assessmentPlan: "",
  notes: "",
});
const uid = () => crypto.randomUUID();

export function PlanEditor({ session, close }: { session: TeachingSession; close: () => void }) {
  const { pending, stale, session: current } = useTeaching();
  const [plan, setPlan] = useState<TeachingPlan>(() =>
    structuredClone(session.plan?.plan ?? blankPlan()),
  );
  const [dirty, setDirty] = useState(false),
    [picker, setPicker] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState(""),
    [materialError, setMaterialError] = useState("");
  const disabled = pending || stale || uploading || !current?.canPrepare;
  function patch(value: Partial<TeachingPlan>) {
    setPlan((draft) => ({ ...draft, ...value }));
    setDirty(true);
  }
  const texts = [
    ["objectives", "教学目标", true],
    ["keyPoints", "教学重点", false],
    ["difficulties", "教学难点", false],
    ["boardPlan", "板书设计", false],
    ["assessmentPlan", "课堂评价计划", false],
    ["notes", "教师备课备注", false],
  ] as const;
  return (
    <>
      <p className={styles.help}>
        基于教案 v{session.planVersion}、安排绑定 v{session.bindingVersion}
        。保存草稿后还需人工确认；修改已确认教案不会自动替换确认版本。
      </p>
      <TeachingActionForm
        dirty={dirty}
        allowed={!disabled}
        submitLabel="保存教案草稿"
        onSaved={close}
        onReload={close}
        onCancel={close}
        command={() => ({
          type: "teaching.plan.save",
          sessionId: session.id,
          expectedVersion: session.version,
          expectedPlanVersion: session.planVersion,
          expectedBindingVersion: session.bindingVersion,
          plan,
        })}
      >
        <Field label="教案标题">
          <input
            required
            maxLength={200}
            value={plan.title}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </Field>
        {texts.slice(0, 3).map(([key, label, required]) => (
          <Field key={key} label={label}>
            <textarea
              required={required}
              maxLength={10000}
              value={plan[key]}
              onChange={(event) => patch({ [key]: event.target.value })}
            />
          </Field>
        ))}
        <section className={styles.section}>
          <div className={styles.entryHeader}>
            <h3>教学活动</h3>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || plan.activities.length >= 50}
              onClick={() =>
                patch({
                  activities: [
                    ...plan.activities,
                    {
                      id: uid(),
                      title: "",
                      minutes: 5,
                      teacherActions: "",
                      studentActions: "",
                      assessment: "",
                    },
                  ],
                })
              }
            >
              添加教学活动
            </button>
          </div>
          <p className={styles.help}>
            按实际授课顺序填写，当前活动预计{" "}
            {plan.activities.reduce((sum, activity) => sum + activity.minutes, 0)} 分钟。
          </p>
          {plan.activities.map((activity, index) => (
            <div className={styles.entry} key={activity.id}>
              <div className={styles.entryHeader}>
                <strong>活动 {index + 1}</strong>
                <div className="p-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled || index === 0}
                    onClick={() => {
                      const next = [...plan.activities];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      patch({ activities: next });
                    }}
                  >
                    上移活动 {index + 1}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => {
                      if (window.confirm("移除此教学活动？"))
                        patch({
                          activities: plan.activities.filter((entry) => entry.id !== activity.id),
                        });
                    }}
                  >
                    移除活动 {index + 1}
                  </button>
                </div>
              </div>
              <div className="p-form-grid">
                <Field label={`活动 ${index + 1} 名称`}>
                  <input
                    required
                    maxLength={200}
                    value={activity.title}
                    onChange={(event) =>
                      patch({
                        activities: plan.activities.map((entry) =>
                          entry.id === activity.id
                            ? { ...entry, title: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`活动 ${index + 1} 分钟`}>
                  <input
                    type="number"
                    required
                    min={1}
                    max={480}
                    step={1}
                    value={activity.minutes}
                    onChange={(event) =>
                      patch({
                        activities: plan.activities.map((entry) =>
                          entry.id === activity.id
                            ? { ...entry, minutes: Number(event.target.value) }
                            : entry,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
              {(
                [
                  ["teacherActions", "教师活动"],
                  ["studentActions", "学生活动"],
                  ["assessment", "评价与观察"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={`活动 ${index + 1} ${label}`}>
                  <textarea
                    maxLength={10000}
                    value={activity[key]}
                    onChange={(event) =>
                      patch({
                        activities: plan.activities.map((entry) =>
                          entry.id === activity.id
                            ? { ...entry, [key]: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          ))}
        </section>
        <section className={styles.section}>
          <div className={styles.entryHeader}>
            <h3>教学材料</h3>
            <div className="p-actions">
              <button
                type="button"
                className="button secondary"
                disabled={disabled || plan.materials.length >= 50}
                onClick={() =>
                  patch({
                    materials: [
                      ...plan.materials,
                      { id: uid(), title: "", kind: "TEXT", content: "" },
                    ],
                  })
                }
              >
                添加文字材料
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={disabled || plan.materials.length >= 50}
                onClick={() => setPicker(true)}
              >
                从题库选取材料
              </button>
            </div>
          </div>
          {materialError && (
            <p className="p-notice error" role="alert">
              {materialError}
            </p>
          )}
          <Field label="上传图片材料" hint="图片保存至本站私有资源；教案确认不会自动向学生公开。">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled || plan.materials.length >= 50}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file || disabled) return;
                setUploading(true);
                setUploadError("");
                setDirty(true);
                try {
                  const data = new FormData();
                  data.set("file", file);
                  const result = await apiRequest<{ url: string }>("/api/platform/assets", {
                    method: "POST",
                    body: data,
                  });
                  setPlan((draft) => ({
                    ...draft,
                    materials: [
                      ...draft.materials,
                      { id: uid(), title: file.name, kind: "ASSET", content: "", url: result.url },
                    ],
                  }));
                } catch (cause) {
                  setUploadError(
                    cause instanceof Error ? cause.message : "图片上传失败，请重新选择图片重试。",
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </Field>
          {uploading && <p role="status">正在上传材料，完成后可保存教案。</p>}
          {uploadError && (
            <p className="p-notice error" role="alert">
              {uploadError}。教案草稿仍保留，可重新选择图片上传。
            </p>
          )}
          {plan.materials.map((material, index) => (
            <div className={styles.entry} key={material.id}>
              <div className={styles.entryHeader}>
                <strong>
                  材料 {index + 1} ·{" "}
                  {{ TEXT: "文字", ASSET: "图片", QUESTION: "题库摘录" }[material.kind]}
                </strong>
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm("移除此教学材料？"))
                      patch({
                        materials: plan.materials.filter((entry) => entry.id !== material.id),
                      });
                  }}
                >
                  移除材料 {index + 1}
                </button>
              </div>
              <Field label={`材料 ${index + 1} 标题`}>
                <input
                  required
                  maxLength={200}
                  value={material.title}
                  onChange={(event) =>
                    patch({
                      materials: plan.materials.map((entry) =>
                        entry.id === material.id ? { ...entry, title: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </Field>
              {material.kind === "QUESTION" ? (
                <TeachingQuestionMaterial content={material.content} />
              ) : (
                <Field label={`材料 ${index + 1} 内容或图像说明`}>
                  <textarea
                    maxLength={20000}
                    value={material.content}
                    onChange={(event) =>
                      patch({
                        materials: plan.materials.map((entry) =>
                          entry.id === material.id
                            ? { ...entry, content: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                </Field>
              )}
              {material.url && (
                <a href={material.url} target="_blank" rel="noreferrer">
                  查看材料 {index + 1} 原图
                </a>
              )}
            </div>
          ))}
        </section>
        {texts.slice(3).map(([key, label]) => (
          <Field key={key} label={label}>
            <textarea
              maxLength={key === "notes" ? 20000 : 10000}
              value={plan[key]}
              onChange={(event) => patch({ [key]: event.target.value })}
            />
          </Field>
        ))}
      </TeachingActionForm>
      <QuestionBankPicker
        open={picker && !disabled}
        onOpenChange={setPicker}
        subject=""
        usedIds={plan.materials.flatMap((material) =>
          material.questionId ? [material.questionId] : [],
        )}
        onImport={(question) => {
          const material: TeachingPlan["materials"][number] = {
            id: uid(),
            title: `${question.subject} · ${question.content.stem.slice(0, 60)}`,
            kind: "QUESTION",
            questionId: question.id,
            content: JSON.stringify({
              source: "QUESTION_SNAPSHOT",
              questionId: question.id,
              updatedAt: question.updatedAt,
              type: question.type,
              subject: question.subject,
              grade: question.grade,
              content: question.content,
            }),
          };
          if (!teachingPlanSchema.shape.materials.element.safeParse(material).success) {
            setMaterialError(
              `「${material.title}」的完整题目快照超过单份材料限制（20000 字符），未加入教案。原教案仍保留，请选取较短题目或拆分备课材料；系统不会截断题目、答案或解析。`,
            );
            return;
          }
          setMaterialError("");
          patch({ materials: [...plan.materials, material] });
        }}
      />
    </>
  );
}

export function PlanReading({ plan }: { plan: TeachingPlan }) {
  return (
    <div className={styles.stack}>
      <h3>{plan.title}</h3>
      {(
        [
          ["objectives", "教学目标"],
          ["keyPoints", "教学重点"],
          ["difficulties", "教学难点"],
        ] as const
      ).map(
        ([key, label]) =>
          plan[key] && (
            <section key={key}>
              <h4>{label}</h4>
              <MarkdownText text={plan[key]} />
            </section>
          ),
      )}
      {!!plan.activities.length && (
        <section>
          <h4>教学活动</h4>
          {plan.activities.map((activity, index) => (
            <div className={styles.entry} key={activity.id}>
              <strong>
                {index + 1}. {activity.title} · {activity.minutes} 分钟
              </strong>
              <p>教师活动：{activity.teacherActions || "未填写"}</p>
              <p>学生活动：{activity.studentActions || "未填写"}</p>
              <p>评价与观察：{activity.assessment || "未填写"}</p>
            </div>
          ))}
        </section>
      )}
      {!!plan.materials.length && (
        <section>
          <h4>教学材料</h4>
          {plan.materials.map((material) => (
            <div className={styles.entry} key={material.id}>
              <strong>{material.title}</strong>
              {material.kind === "QUESTION" ? (
                <TeachingQuestionMaterial content={material.content} />
              ) : (
                <MarkdownText text={material.content} />
              )}
              {material.url && (
                <a href={material.url} target="_blank" rel="noreferrer">
                  新窗口查看图片材料
                </a>
              )}
            </div>
          ))}
        </section>
      )}
      {(
        [
          ["boardPlan", "板书设计"],
          ["assessmentPlan", "课堂评价计划"],
          ["notes", "教师备课备注"],
        ] as const
      ).map(
        ([key, label]) =>
          plan[key] && (
            <section key={key}>
              <h4>{label}</h4>
              <MarkdownText text={plan[key]} />
            </section>
          ),
      )}
    </div>
  );
}

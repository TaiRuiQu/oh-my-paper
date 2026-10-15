"use client";
import { cohortKey, cohortLabel } from "@/lib/student-cohort";
import { useEffect, useRef, useState } from "react";
import { SUBJECTS, type Classroom, type SchoolStage } from "@/contracts/platform";
import { assignmentKey, TEACHING_ROLES, type TeachingAssignment } from "@/contracts/permissions";
import { Field } from "./primitives";

export function assignmentLabel(row: TeachingAssignment, classrooms: Classroom[]) {
  if (row.role === "SCHOOL_ADMIN") return "学校总管理 · 全校";
  if (row.role === "GRADE_DIRECTOR") return `年级主任 · ${cohortLabel(row)}`;
  const classroom = classrooms.find((c) => c.id === row.classroomId);
  const name = classroom ? `${cohortLabel(classroom)} ${classroom.name}` : "班级已删除";
  return `${TEACHING_ROLES[row.role]} · ${name}${row.role === "SUBJECT_TEACHER" ? ` · ${row.subject}` : " · 全科"}`;
}

export function TeachingPermissions({
  name,
  assignments,
  classrooms,
  busy,
  onSave,
  onCancel,
}: {
  name: string;
  assignments: TeachingAssignment[];
  classrooms: Classroom[];
  busy: boolean;
  onSave: (rows: TeachingAssignment[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(assignments);
  const duplicated = new Set(rows.map(assignmentKey)).size !== rows.length;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector("select")?.focus();
  }, []);
  const cohorts = [
    ...new Map(
      classrooms.map((c) => [cohortKey(c), { stage: c.stage as SchoolStage, cohort: c.cohort }]),
    ).values(),
  ];
  function replace(index: number, row: TeachingAssignment) {
    setRows((previous) => previous.map((value, i) => (i === index ? row : value)));
  }
  return (
    <form
      ref={form}
      className="p-form"
      aria-label={`${name}的教学权限`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !duplicated) onSave(rows);
      }}
    >
      <h3>{name}的教学身份</h3>
      <p className="p-muted">
        多个身份合并生效。班主任可查看本班全科，任课老师可查看所选班级的对应学科。学校总管理和年级主任可查看其范围内的考试、作业及成绩。
      </p>
      <fieldset disabled={busy} className="p-permission-fields">
        {rows.map((row, index) => (
          <div className="p-permission-row" key={index}>
            <Field label={`身份 ${index + 1}`}>
              <select
                value={row.role}
                onChange={(event) => {
                  const role = event.target.value as TeachingAssignment["role"];
                  replace(
                    index,
                    role === "SCHOOL_ADMIN"
                      ? { role }
                      : role === "GRADE_DIRECTOR"
                        ? {
                            role,
                            stage: cohorts[0]?.stage ?? "高中",
                            cohort: cohorts[0]?.cohort ?? "",
                          }
                        : role === "HOMEROOM"
                          ? { role, classroomId: classrooms[0]?.id ?? "" }
                          : { role, classroomId: classrooms[0]?.id ?? "", subject: "语文" },
                  );
                }}
              >
                {Object.entries(TEACHING_ROLES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {row.role === "SCHOOL_ADMIN" ? (
              <p className="p-muted">全校所有届别、班级与学科</p>
            ) : row.role === "GRADE_DIRECTOR" ? (
              <Field label={`身份 ${index + 1} 的届别`}>
                <select
                  required
                  value={cohortKey(row)}
                  onChange={(e) => {
                    const scope = cohorts.find((c) => cohortKey(c) === e.target.value);
                    if (scope) replace(index, { ...row, ...scope });
                  }}
                >
                  <option value="">选择届别</option>
                  {[
                    ...new Map(
                      [...cohorts, { stage: row.stage, cohort: row.cohort }]
                        .filter((c) => c.cohort)
                        .map((c) => [cohortKey(c), c]),
                    ).values(),
                  ].map((scope) => (
                    <option key={cohortKey(scope)} value={cohortKey(scope)}>
                      {cohortLabel(scope)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                <Field label={`身份 ${index + 1} 的班级`}>
                  <select
                    required
                    value={row.classroomId}
                    onChange={(e) => replace(index, { ...row, classroomId: e.target.value })}
                  >
                    <option value="">选择班级</option>
                    {classrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {cohortLabel(c)} · {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {row.role === "SUBJECT_TEACHER" && (
                  <Field label={`身份 ${index + 1} 的学科`}>
                    <select
                      value={row.subject}
                      onChange={(e) =>
                        replace(index, { ...row, subject: e.target.value as typeof row.subject })
                      }
                    >
                      {SUBJECTS.map((subject) => (
                        <option key={subject}>{subject}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
            <button
              className="button secondary"
              type="button"
              aria-label={`移除身份 ${index + 1}`}
              onClick={() => setRows((previous) => previous.filter((_, i) => i !== index))}
            >
              移除
            </button>
          </div>
        ))}
        {!rows.length && (
          <p className="p-muted">
            尚未分配教学身份。保存后，该教师无法查看任何班级的教学任务与成绩。
          </p>
        )}
        {!classrooms.length && (
          <p className="p-muted">
            请先在「班级与学生」中创建班级，再配置年级主任、班主任或任课老师。
          </p>
        )}
        <button
          className="button secondary"
          type="button"
          disabled={rows.length >= 200}
          onClick={() =>
            setRows((previous) => [
              ...previous,
              { role: "SUBJECT_TEACHER", classroomId: classrooms[0]?.id ?? "", subject: "语文" },
            ])
          }
        >
          添加教学身份
        </button>
      </fieldset>
      {duplicated && <p role="alert">教学身份重复，请修改或移除重复项后再保存。</p>}
      <p className="p-muted">
        任课老师身份决定可阅学科，班主任和管理身份只扩大教学数据查看范围。只分配任教学科时，不展示全科总分和总排名。学校总管理不包含账号与模型配置权限。
      </p>
      <div className="p-actions">
        <button className="button" disabled={busy || duplicated}>
          {busy ? "正在保存…" : "保存教学权限"}
        </button>
        <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

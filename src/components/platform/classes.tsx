"use client";
import { useState } from "react";
import type { Classroom, PlatformState, Student } from "@/contracts/platform";
import { Empty, Field, Panel, Submit, readForm, stringField } from "./primitives";
import type { Mutate } from "./questions";
export function Classes({
  state,
  mutate,
  pending,
}: {
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
}) {
  const [classId, setClassId] = useState(state.classrooms[0]?.id ?? ""),
    [editing, setEditing] = useState<Classroom | null | undefined>(),
    [student, setStudent] = useState<Student | null | undefined>();
  const classroom = state.classrooms.find((c) => c.id === classId),
    teachers = state.users.filter((u) => u.role !== "STUDENT");
  return (
    <>
      <Panel
        title="班级与学生"
        description="卡号用于答题卡识别；绑定账号后，学生只能查看自己的考试和学情。"
        actions={
          <button className="button" onClick={() => setEditing(null)}>
            新建班级
          </button>
        }
      >
        {editing !== undefined && (
          <form
            className="p-form"
            onSubmit={async (e) => {
              const d = readForm(e);
              const r = await mutate({
                type: "classroom.save",
                classroom: {
                  id: editing?.id,
                  name: stringField(d, "name"),
                  grade: stringField(d, "grade"),
                  reviewerIds: d.getAll("reviewerIds").map(String),
                },
              });
              if (r.error) return;
              setEditing(undefined);
              if (r.id) setClassId(r.id);
            }}
          >
            <div className="p-form-grid">
              <Field label="班级名称">
                <input required name="name" defaultValue={editing?.name} />
              </Field>
              <Field label="年级">
                <input required name="grade" defaultValue={editing?.grade ?? "高一"} />
              </Field>
            </div>
            <div>
              <h3>共同阅卷教师</h3>
              <p className="p-muted">授权教师可独立完成双评与仲裁。</p>
              <div className="p-actions">
                {teachers.map((t) => (
                  <label key={t.id} className="p-check">
                    <input
                      type="checkbox"
                      name="reviewerIds"
                      value={t.id}
                      defaultChecked={editing?.reviewerIds.includes(t.id)}
                    />
                    {t.name} ({t.email})
                  </label>
                ))}
              </div>
            </div>
            <div className="p-actions">
              <Submit pending={pending}>保存班级</Submit>
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(undefined)}
              >
                取消
              </button>
            </div>
          </form>
        )}
        <div className="p-toolbar">
          <select
            aria-label="选择班级"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setStudent(undefined);
            }}
          >
            <option value="">选择班级</option>
            {state.classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.grade}
              </option>
            ))}
          </select>
          {classroom && (
            <>
              <button className="button secondary" onClick={() => setEditing(classroom)}>
                编辑班级
              </button>
              <button className="button" onClick={() => setStudent(null)}>
                添加学生
              </button>
              <span className="p-muted">{classroom.students.length} 位学生</span>
            </>
          )}
        </div>
        {student !== undefined && classroom && (
          <form
            className="p-form"
            key={student?.id ?? "new"}
            onSubmit={async (e) => {
              const d = readForm(e);
              const result = await mutate({
                type: "student.save",
                student: {
                  id: student?.id,
                  classroomId: classId,
                  studentNumber: stringField(d, "studentNumber"),
                  name: stringField(d, "name"),
                  email: stringField(d, "email") || undefined,
                },
              });
              if (result.error) return;
              setStudent(undefined);
            }}
          >
            <div className="p-form-grid">
              <Field label="学生姓名">
                <input required name="name" defaultValue={student?.name} />
              </Field>
              <Field label="卡号 / 学号" hint="保持与答题卡填涂位数一致，允许前导零。">
                <input
                  required
                  name="studentNumber"
                  inputMode="numeric"
                  defaultValue={student?.studentNumber}
                />
              </Field>
              <Field label="学生账号邮箱（可选）">
                <input
                  type="email"
                  name="email"
                  defaultValue={state.users.find((u) => u.id === student?.userId)?.email}
                />
              </Field>
            </div>
            <div className="p-actions">
              <Submit pending={pending}>保存学生</Submit>
              <button
                type="button"
                className="button secondary"
                onClick={() => setStudent(undefined)}
              >
                取消
              </button>
            </div>
          </form>
        )}
        {classroom?.students.length ? (
          <div className="p-table" role="region" aria-label="班级学生名单" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>卡号</th>
                  <th>账号绑定</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {classroom.students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.studentNumber}</td>
                    <td>
                      {s.userId ? <span className="p-status success">已绑定</span> : "未绑定"}
                    </td>
                    <td>
                      <div className="p-actions">
                        <button className="button secondary" onClick={() => setStudent(s)}>
                          编辑
                        </button>
                        <button
                          className="link-button"
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(`移除学生 ${s.name}？`))
                              void mutate({ type: "student.delete", id: s.id });
                          }}
                        >
                          移除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {classroom ? "这个班级还没有学生。添加学生并分配唯一卡号。" : "选择或创建一个班级。"}
          </Empty>
        )}
      </Panel>
    </>
  );
}

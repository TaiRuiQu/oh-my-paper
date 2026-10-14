"use client";
import type { AccountCredentials } from "@/contracts/auth";
import { AccountCredentialsPanel } from "./account-credentials";
import { GradeSelect } from "./grade-select";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDomain } from "./domain-provider";
import { Field, Panel, Empty, readForm, stringField } from "./primitives";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";

function ClassNavigation({ id, active }: { id: string; active: string }) {
  const base = `/workspace/classes/${id}`;
  return (
    <PageTabs
      active={active}
      links={[
        { href: base, label: "班级概览" },
        { href: `${base}/students`, label: "学生名单" },
        { href: `${base}/reports`, label: "班级学情" },
        { href: `${base}/settings`, label: "班级设置" },
      ]}
    />
  );
}

export function ClassListPage() {
  const { state } = useDomain();
  const [query, setQuery] = useState("");
  const classes = state.classrooms.filter((c) => `${c.name} ${c.grade}`.includes(query));
  return (
    <>
      <PageHeader
        title="班级与学生"
        description="维护教学班级、学生身份与共同评阅教师，为每次考试和作业建立参与名单。"
        actions={
          <Button asChild>
            <Link href="/workspace/classes/new">
              <Plus />
              新建班级
            </Link>
          </Button>
        }
      />
      <Panel title="教学班级">
        <div className="p-toolbar">
          <Input
            aria-label="搜索班级"
            placeholder="班级名称或年级"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {classes.length ? (
          classes.map((c) => (
            <div className="p-list-row" key={c.id}>
              <div>
                <Link href={`/workspace/classes/${c.id}`}>
                  <strong>{c.name}</strong>
                </Link>
                <small>
                  {c.grade} · {c.students.length} 位学生 · {c.reviewerIds.length} 位共同评阅教师
                </small>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/workspace/classes/${c.id}/students`}>
                  管理学生
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          ))
        ) : (
          <Empty>创建班级后添加学生，并为每位学生分配唯一学号。</Empty>
        )}
      </Panel>
    </>
  );
}

export function ClassEditPage({ id }: { id?: string }) {
  const { state, mutate, pending } = useDomain();
  const router = useRouter();
  const c = state.classrooms.find((c) => c.id === id);
  if (id && !c) return <MissingRecord back="/workspace/classes" />;
  return (
    <>
      <PageHeader
        title={c ? "班级设置" : "新建班级"}
        description="设置班级名称、年级和评阅协作权限。"
        back={{
          href: c ? `/workspace/classes/${id}` : "/workspace/classes",
          label: c?.name ?? "全部班级",
        }}
      />
      {c && <ClassNavigation id={c.id} active={`/workspace/classes/${id}/settings`} />}
      <Panel title="班级资料">
        <form
          className="p-form"
          onSubmit={async (e) => {
            const d = readForm(e);
            const r = await mutate({
              type: "classroom.save",
              classroom: {
                id,
                name: stringField(d, "name"),
                grade: stringField(d, "grade"),
                reviewerIds: d.getAll("reviewerIds").map(String),
              },
            });
            if (r.id) router.push(`/workspace/classes/${r.id}`);
          }}
        >
          <div className="p-form-grid">
            <Field label="班级名称">
              <Input required name="name" defaultValue={c?.name} placeholder="例如：高一（1）班" />
            </Field>
            <Field label="年级">
              <GradeSelect required name="grade" defaultValue={c?.grade ?? "高中一年级"} />
            </Field>
          </div>
          <div>
            <h3>共同评阅教师</h3>
            <p className="p-muted">授权教师可参与本班考试的独立双评与仲裁。</p>
            <div className="p-actions">
              {state.users
                .filter((u) => u.role !== "STUDENT")
                .map((u) => (
                  <label className="p-check" key={u.id}>
                    <input
                      type="checkbox"
                      name="reviewerIds"
                      value={u.id}
                      defaultChecked={c?.reviewerIds.includes(u.id)}
                    />
                    {u.name}（{u.username ?? u.email}）
                  </label>
                ))}
            </div>
          </div>
          <div className="p-actions">
            <Button disabled={pending}>{pending ? "正在保存…" : "保存班级"}</Button>
            <Button asChild variant="outline">
              <Link href={c ? `/workspace/classes/${id}` : "/workspace/classes"}>取消</Link>
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}

export function ClassDetailPage({ id, students = false }: { id: string; students?: boolean }) {
  const { state, mutate, pending } = useDomain();
  const c = state.classrooms.find((c) => c.id === id);
  if (!c) return <MissingRecord back="/workspace/classes" />;
  return (
    <>
      <PageHeader
        title={students ? `${c.name} · 学生名单` : c.name}
        description={`${c.grade} · ${c.students.length} 位学生 · 学号用于身份匹配，绑定账号后学生可以查看本人报告。`}
        back={{ href: "/workspace/classes", label: "全部班级" }}
        actions={
          <Button asChild>
            <Link href={`/workspace/classes/${id}/students/new`}>
              <Plus />
              添加学生
            </Link>
          </Button>
        }
      />
      <ClassNavigation id={id} active={`/workspace/classes/${id}${students ? "/students" : ""}`} />
      {!students && (
        <Panel title="最近教学安排">
          {state.assessments.filter((a) => a.classroomIds.includes(id)).length ? (
            state.assessments
              .filter((a) => a.classroomIds.includes(id))
              .slice(0, 5)
              .map((a) => (
                <div className="p-list-row" key={a.id}>
                  <Link href={`${a.kind === "EXAM" ? "/exams" : "/homework/assignments"}/${a.id}`}>
                    {a.name}
                  </Link>
                  <span className="p-muted">{a.published ? "成绩已发布" : "进行中"}</span>
                </div>
              ))
          ) : (
            <Empty>班级学生录入后，可布置第一份作业或安排考试。</Empty>
          )}
        </Panel>
      )}
      <Panel title="学生名单">
        {c.students.length ? (
          <div className="p-table" role="region" aria-label="学生名单" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>学号 / 卡号</th>
                  <th>账号状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {c.students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.studentNumber}</td>
                    <td>{s.userId ? "已绑定" : "未绑定"}</td>
                    <td>
                      <div className="p-actions">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/workspace/classes/${id}/students/${s.id}/edit`}>
                            编辑资料
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(`从班级中移除 ${s.name}？`))
                              void mutate({ type: "student.delete", id: s.id });
                          }}
                        >
                          移除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>添加学生并分配六位学号，后续答题卡可自动匹配身份。</Empty>
        )}
      </Panel>
    </>
  );
}

export function StudentEditPage({
  classroomId,
  studentId,
}: {
  classroomId: string;
  studentId?: string;
}) {
  const { state, mutate, pending } = useDomain();
  const [credentials, setCredentials] = useState<AccountCredentials>();
  const router = useRouter();
  const c = state.classrooms.find((c) => c.id === classroomId);
  const student = c?.students.find((s) => s.id === studentId);
  if (!c || (studentId && !student)) return <MissingRecord back="/workspace/classes" />;
  return (
    <>
      <PageHeader
        title={student ? "编辑学生资料" : "添加学生"}
        description={`${c.name} · 使用真实姓名，学生以学号登录。新增学生的密码由系统生成。`}
        back={{ href: `/workspace/classes/${classroomId}/students`, label: "班级学生名单" }}
      />
      {credentials ? <AccountCredentialsPanel credentials={credentials}>
        <Button asChild><Link href={`/workspace/classes/${classroomId}/students`}>返回学生名单</Link></Button>
      </AccountCredentialsPanel> : <Panel title="学生资料">
        <form
          className="p-form"
          onSubmit={async (e) => {
            const d = readForm(e);
            const r = await mutate({
              type: "student.save",
              student: {
                id: studentId,
                classroomId,
                name: stringField(d, "name"),
                studentNumber: stringField(d, "studentNumber") || undefined,
                userId: stringField(d, "userId") || undefined,
              },
            });
            if (r.credentials) setCredentials(r.credentials);
            else if (!r.error) router.push(`/workspace/classes/${classroomId}/students`);
          }}
        >
          <div className="p-form-grid">
            <Field label="真实姓名">
              <Input name="name" required defaultValue={student?.name} />
            </Field>
            <Field label="学号 / 卡号（可选）" hint="留空自动生成六位学号。指定学号须为数字，答题卡建议使用六位。">
              <Input
                name="studentNumber"
                pattern="[0-9]{1,20}"
                maxLength={20}
                readOnly={!!student?.userId}
                inputMode="numeric"
                defaultValue={student?.studentNumber}
              />
            </Field>
            {!student?.userId && <Field label="已有学生账号（可选）" hint="已分配账号的学生可选择账号加入本班；留空则创建新账号。">
              <select name="userId" defaultValue="">
                <option value="">创建新学生账号</option>
                {state.users.filter((u) => u.role === "STUDENT").map((u) => <option key={u.id} value={u.id}>{u.name}（{u.username ?? u.email}）</option>)}
              </select>
            </Field>}
          </div>
          <div className="p-actions">
            <Button disabled={pending}>{pending ? "正在保存…" : "保存学生"}</Button>
            <Button asChild variant="outline">
              <Link href={`/workspace/classes/${classroomId}/students`}>取消</Link>
            </Button>
          </div>
        </form>
      </Panel>}
    </>
  );
}

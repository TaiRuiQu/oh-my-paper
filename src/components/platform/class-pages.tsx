"use client";
import { SCHOOL_STAGES, type Classroom, type PlatformState } from "@/contracts/platform";
import { cohortLabel } from "@/lib/student-cohort";
import { assessmentPublicationLabel } from "@/lib/assessment-roster";
import { AccountImport } from "./account-import";
import type { AccountCredentials } from "@/contracts/auth";
import { AccountCredentialsPanel } from "./account-credentials";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/http-client";
import { useDomain } from "./domain-provider";
import { Field, Panel, Empty, readForm, stringField } from "./primitives";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";
import { useUnsavedChanges } from "./use-unsaved-changes";

function canManageClassroom(actor: PlatformState["actor"], classroom?: Classroom) {
  return (
    actor.role === "ADMIN" ||
    (actor.role === "TEACHER" && (!classroom || classroom.ownerId === actor.id))
  );
}

function studentLoginLabel(student: { userLogin?: string | null }) {
  return student.userLogin ?? "账号信息暂不可用";
}

/** Search-as-you-type picker backed by the on-demand account directory. */
function StudentAccountPicker({
  disabled,
  selected,
  onSelect,
  onPick,
}: {
  disabled: boolean;
  selected?: PlatformState["users"][number];
  onSelect: (user?: PlatformState["users"][number]) => void;
  onPick: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlatformState["users"]>([]);
  const [error, setError] = useState("");
  const reader = useRef<AbortController | null>(null);
  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) return;
    const controller = new AbortController();
    reader.current?.abort();
    reader.current = controller;
    apiRequest<{ users: PlatformState["users"] }>(
      `/api/platform/users?${new URLSearchParams({ role: "STUDENT", query: keyword })}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (controller.signal.aborted) return;
        setResults(r.users);
        setError("");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "搜索失败，请重试。");
      });
    return () => controller.abort();
  }, [query]);
  if (selected)
    return (
      <div className="p-list-row">
        <div>
          <strong>已选定账号：{selected.name}</strong>
          <small>{selected.username ?? selected.email}</small>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label="重新搜索学生账号"
          onClick={() => {
            onSelect(undefined);
            setQuery("");
            setResults([]);
            setError("");
            onPick();
          }}
        >
          重新选择
        </Button>
      </div>
    );
  return (
    <div>
      <Input
        aria-label="搜索已有学生账号"
        placeholder="输入姓名、学号或登录账号"
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value.trim()) {
            setResults([]);
            setError("");
          }
        }}
      />
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      {results.map((user) => (
        <button
          key={user.id}
          type="button"
          className="p-list-row"
          aria-label={`选择学生账号 ${user.name}`}
          disabled={disabled}
          onClick={() => {
            onSelect(user);
            onPick();
          }}
        >
          <span>
            {user.name}（{user.username ?? user.email}）
          </span>
        </button>
      ))}
      {query.trim() && !error && !results.length && (
        <p className="p-muted">没有匹配的学生账号，可直接保存以创建新账号。</p>
      )}
    </div>
  );
}

function ClassReadOnlyNotice() {
  return (
    <p className="p-notice" role="status">
      当前班级为只读。班级资料和学生名单由班级创建者或管理员维护；教学身份不包含班级资料和学生名单的修改权限。
    </p>
  );
}

function ClassManagementUnavailable({ classroom }: { classroom?: Classroom }) {
  return (
    <>
      <PageHeader
        title={classroom ? `${classroom.name} · 班级资料` : "班级管理"}
        description={
          classroom
            ? "请联系班级创建者或管理员修改班级资料和学生名单。"
            : "学生账号只能查看本人学习数据，班级和学生名单由教师或管理员维护。"
        }
        back={{
          href: classroom ? `/workspace/classes/${classroom.id}` : "/workspace",
          label: classroom ? "班级概览" : "返回首页",
        }}
      />
      {classroom && <ClassReadOnlyNotice />}
    </>
  );
}

function ClassNavigation({ id, active }: { id: string; active: string }) {
  const { state } = useDomain();
  const classroom = state.classrooms.find((c) => c.id === id);
  const manageable = classroom && canManageClassroom(state.actor, classroom);
  const base = `/workspace/classes/${id}`;
  return (
    <PageTabs
      active={active}
      links={[
        { href: base, label: "班级概览" },
        { href: `${base}/students`, label: "学生名单" },
        { href: `${base}/reports`, label: "班级学情" },
        ...(manageable ? [{ href: `${base}/settings`, label: "班级设置" }] : []),
      ]}
    />
  );
}

export function ClassListPage() {
  const { state } = useDomain();
  const [query, setQuery] = useState("");
  const searchQuery = query.trim();
  const classes = state.classrooms.filter((c) =>
    `${c.name} ${cohortLabel(c)}`.includes(searchQuery),
  );
  if (state.actor.role === "STUDENT") return <ClassManagementUnavailable />;
  return (
    <>
      <PageHeader
        title="班级与学生"
        description="维护教学班级与学生身份，为每次考试和作业建立参与名单。"
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
            placeholder="班级名称、学段或届别"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <Button variant="outline" onClick={() => setQuery("")}>
              清空搜索
            </Button>
          )}
        </div>
        {classes.length ? (
          classes.map((c) => (
            <div className="p-list-row" key={c.id}>
              <div>
                <Link href={`/workspace/classes/${c.id}`}>
                  <strong>{c.name}</strong>
                </Link>
                <small>
                  {cohortLabel(c)} · {c.students.length} 位学生
                  {!canManageClassroom(state.actor, c) && " · 只读"}
                </small>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/workspace/classes/${c.id}/students`}>
                  {canManageClassroom(state.actor, c) ? "管理学生" : "查看学生"}
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          ))
        ) : (
          <Empty>
            {state.classrooms.length
              ? `没有找到与“${searchQuery}”匹配的班级，请修改关键词或清空搜索。`
              : "创建班级后添加学生，并为每位学生分配唯一学号。"}
          </Empty>
        )}
      </Panel>
    </>
  );
}

export function ClassEditPage({ id }: { id?: string }) {
  const { state, mutate, pending } = useDomain();
  const router = useRouter();
  const [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty,
    "有未保存的班级修改，离开后会丢失。确定离开？",
  );
  const disabled = pending || saving;
  const c = state.classrooms.find((c) => c.id === id);
  if (state.actor.role === "STUDENT") return <ClassManagementUnavailable />;
  if (id && !c) return <MissingRecord back="/workspace/classes" />;
  if (!canManageClassroom(state.actor, c)) return <ClassManagementUnavailable classroom={c} />;
  return (
    <>
      <PageHeader
        title={c ? "班级设置" : "新建班级"}
        description="设置班级名称、学段和学生届别。任课身份由管理员在「账号与权限」中配置。"
        back={{
          href: c ? `/workspace/classes/${id}` : "/workspace/classes",
          label: c?.name ?? "全部班级",
        }}
      />
      {c && <ClassNavigation id={c.id} active={`/workspace/classes/${id}/settings`} />}
      <Panel title="班级资料">
        {error && (
          <p className="p-notice error" role="alert">
            {error}
          </p>
        )}
        {disabled && <p role="status">正在保存班级，暂时不能编辑或取消。</p>}
        <form
          className="p-form"
          inert={disabled}
          aria-busy={disabled}
          onChange={() => setDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current || disabled) return;
            const d = readForm(e);
            submitting.current = true;
            setSaving(true);
            setError("");
            try {
              const r = await mutate({
                type: "classroom.save",
                classroom: {
                  id,
                  name: stringField(d, "name"),
                  stage: stringField(d, "stage"),
                  cohort: stringField(d, "cohort"),
                },
              });
              if (r.error) setError(r.error);
              else if (r.id) {
                markSaved();
                setDirty(false);
                router.push(`/workspace/classes/${r.id}`);
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
            } finally {
              submitting.current = false;
              setSaving(false);
            }
          }}
        >
          <div className="p-form-grid">
            <Field label="班级名称">
              <Input
                required
                name="name"
                disabled={disabled}
                defaultValue={c?.name}
                placeholder="例如：1班"
              />
            </Field>
            <Field label="学段">
              <select required name="stage" disabled={disabled} defaultValue={c?.stage ?? ""}>
                <option value="">选择学段</option>
                {SCHOOL_STAGES.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </Field>
            <Field
              label="学生届别"
              hint="按所选学段的毕业年份填写“届”或按入学年份填写“级”，同一批学生保持一致。"
            >
              <Input
                required
                name="cohort"
                disabled={disabled}
                maxLength={40}
                defaultValue={c?.cohort}
                placeholder="例如：2027届或2024级"
              />
            </Field>
          </div>
          <div className="p-actions">
            <Button disabled={disabled}>{disabled ? "正在保存…" : "保存班级"}</Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (!submitting.current && confirmDiscard())
                  router.push(c ? `/workspace/classes/${id}` : "/workspace/classes");
              }}
            >
              取消
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}

export function ClassDetailPage({ id, students = false }: { id: string; students?: boolean }) {
  const { state, mutate, pending, refresh } = useDomain();
  const [importing, setImporting] = useState(false);
  const c = state.classrooms.find((c) => c.id === id);
  if (state.actor.role === "STUDENT") return <ClassManagementUnavailable />;
  if (!c) return <MissingRecord back="/workspace/classes" />;
  const manageable = canManageClassroom(state.actor, c);
  return (
    <>
      <PageHeader
        title={students ? `${c.name} · 学生名单` : c.name}
        description={`${cohortLabel(c)} · ${c.students.length} 位学生 · 学号用于身份匹配，绑定账号后学生可以查看本人报告。`}
        back={{ href: "/workspace/classes", label: "全部班级" }}
        actions={
          manageable && (
            <Button asChild>
              <Link href={`/workspace/classes/${id}/students/new`}>
                <Plus />
                添加学生
              </Link>
            </Button>
          )
        }
      />
      <ClassNavigation id={id} active={`/workspace/classes/${id}${students ? "/students" : ""}`} />
      {!manageable && <ClassReadOnlyNotice />}
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
                  <span className="p-muted">{assessmentPublicationLabel(a)}</span>
                </div>
              ))
          ) : (
            <Empty>班级学生录入后，可布置第一份作业或安排考试。</Empty>
          )}
        </Panel>
      )}
      <Panel
        title="学生名单"
        actions={
          manageable && (
            <Button
              variant="outline"
              disabled={pending || importing}
              onClick={() => setImporting(true)}
            >
              批量导入学生
            </Button>
          )
        }
      >
        {manageable && importing && (
          <AccountImport
            role="STUDENT"
            classroomId={id}
            refresh={refresh}
            onClose={() => setImporting(false)}
          />
        )}
        {c.students.length ? (
          <div className="p-table" role="region" aria-label="学生名单" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>学号 / 卡号</th>
                  <th>账号状态</th>
                  {manageable && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {c.students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.studentNumber}</td>
                    <td>{s.userId ? `已绑定 · 登录账号：${studentLoginLabel(s)}` : "未绑定"}</td>
                    {manageable && (
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
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {manageable
              ? "添加学生并分配六位学号，后续答题卡可自动匹配身份。"
              : "当前班级尚未添加学生，请联系班级创建者或管理员维护名单。"}
          </Empty>
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
  const [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const [boundUser, setBoundUser] = useState<PlatformState["users"][number]>();
  const submitting = useRef(false);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty,
    "有未保存的学生修改，离开后会丢失。确定离开？",
  );
  const disabled = pending || saving;
  const router = useRouter();
  const c = state.classrooms.find((c) => c.id === classroomId);
  const student = c?.students.find((s) => s.id === studentId);
  const boundLogin = student ? studentLoginLabel(student) : undefined;
  if (state.actor.role === "STUDENT") return <ClassManagementUnavailable />;
  if (!c || (studentId && !student)) return <MissingRecord back="/workspace/classes" />;
  if (!canManageClassroom(state.actor, c)) return <ClassManagementUnavailable classroom={c} />;
  return (
    <>
      <PageHeader
        title={student ? "编辑学生资料" : "添加学生"}
        description={`${c.name} · 学号 / 卡号用于答题身份匹配，学生使用绑定账号登录。新增账号的密码由系统生成。`}
        back={{ href: `/workspace/classes/${classroomId}/students`, label: "班级学生名单" }}
      />
      {credentials ? (
        <AccountCredentialsPanel credentials={credentials}>
          <Button asChild>
            <Link href={`/workspace/classes/${classroomId}/students`}>返回学生名单</Link>
          </Button>
        </AccountCredentialsPanel>
      ) : (
        <Panel title="学生资料">
          {error && (
            <p className="p-notice error" role="alert">
              {error}
            </p>
          )}
          {disabled && <p role="status">正在保存学生，暂时不能编辑或取消。</p>}
          <form
            className="p-form"
            inert={disabled}
            aria-busy={disabled}
            onChange={() => setDirty(true)}
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current || disabled) return;
              const d = readForm(e);
              submitting.current = true;
              setSaving(true);
              setError("");
              try {
                const r = await mutate({
                  type: "student.save",
                  student: {
                    id: studentId,
                    classroomId,
                    name: stringField(d, "name"),
                    studentNumber: stringField(d, "studentNumber") || undefined,
                    userId: student?.userId ? undefined : boundUser?.id,
                  },
                });
                if (r.error) setError(r.error);
                else {
                  markSaved();
                  setDirty(false);
                  if (r.credentials) setCredentials(r.credentials);
                  else router.push(`/workspace/classes/${classroomId}/students`);
                }
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
              } finally {
                submitting.current = false;
                setSaving(false);
              }
            }}
          >
            <div className="p-form-grid">
              <Field label="真实姓名">
                <Input name="name" required disabled={disabled} defaultValue={student?.name} />
              </Field>
              <Field
                label="学号 / 卡号（可选）"
                hint="新建账号时兼作登录账号。绑定已有账号时，留空沿用其数字账号；已有学生的卡号保持不变。指定卡号须为数字，建议六位。"
              >
                <Input
                  name="studentNumber"
                  disabled={disabled}
                  pattern="[0-9]{1,20}"
                  maxLength={20}
                  readOnly={!!student?.userId}
                  inputMode="numeric"
                  defaultValue={student?.studentNumber}
                />
              </Field>
              {student?.userId && (
                <Field label="登录账号" hint="登录请使用此账号；学号 / 卡号单独用于答题身份匹配。">
                  <Input readOnly value={boundLogin ?? "账号信息暂不可用"} />
                </Field>
              )}
              {!student?.userId && (
                <Field
                  label="已有学生账号（可选）"
                  hint="输入姓名、学号或登录账号搜索并选择已分配的账号加入本班；不选择则创建新账号。"
                >
                  <StudentAccountPicker
                    disabled={disabled}
                    selected={boundUser}
                    onSelect={setBoundUser}
                    onPick={() => setDirty(true)}
                  />
                </Field>
              )}
            </div>
            <div className="p-actions">
              <Button disabled={disabled}>{disabled ? "正在保存…" : "保存学生"}</Button>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  if (!submitting.current && confirmDiscard())
                    router.push(`/workspace/classes/${classroomId}/students`);
                }}
              >
                取消
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </>
  );
}

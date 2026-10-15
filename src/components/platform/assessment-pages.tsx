"use client";
import { reviewRule } from "@/lib/document-layout";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useDomain } from "./domain-provider";
import { Panel } from "./primitives";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";
import { AssessmentEditor } from "./assessments";
import { RecordNameEditor } from "./record-name-editor";

function useAssessmentPaths() {
  const { area } = useDomain();
  const homework = area === "homework";
  return {
    homework,
    root: homework ? "/homework/assignments" : "/exams",
    noun: homework ? "作业安排" : "考试",
  };
}
export function AssessmentListPage() {
  const { state } = useDomain();
  const { root, noun, homework } = useAssessmentPaths();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const items = state.assessments.filter(
    (a) => a.name.includes(query) && (!status || a.published === (status === "published")),
  );
  return (
    <>
      <PageHeader
        title={homework ? "作业布置记录" : "考试管理"}
        description={
          homework
            ? "按班级布置练习册，跟进收交、批改和学习反馈。"
            : "安排考试科目与参试班级，跟进扫描、阅卷和成绩发布。"
        }
        actions={
          <>
            {!homework && (
              <Button asChild variant="outline">
                <Link href="/exams/import">扫描导入试卷</Link>
              </Button>
            )}
            <Button asChild>
              <Link href={`${root}/new`}>
                <Plus />
                {homework ? "布置作业" : "安排考试"}
              </Link>
            </Button>
          </>
        }
      />
      <Panel title={`全部${noun}`} description={`${state.assessments.length} 条记录`}>
        <div className="p-toolbar">
          <Input
            aria-label={`搜索${noun}`}
            placeholder={`搜索${noun}名称`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="筛选发布状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="pending">进行中</option>
            <option value="published">已发布</option>
          </select>
        </div>
        {items.length ? (
          <div className="p-table" role="region" aria-label={`${noun}列表`} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>参与班级</th>
                  <th>学科</th>
                  <th>阅卷范围</th>
                  <th>{homework ? "批改" : "阅卷"}进度</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const subs = state.submissions.filter((s) => s.assessmentId === a.id);
                  return (
                    <tr key={a.id}>
                      <td>
                        <RecordNameEditor
                          record={a}
                          kind="assessment"
                          noun={noun}
                          href={`${root}/${a.id}`}
                        />
                        <small>{new Date(a.createdAt).toLocaleDateString("zh-CN")}</small>
                      </td>
                      <td>
                        {a.classroomIds
                          .map((id) => state.classrooms.find((c) => c.id === id)?.name)
                          .join("、")}
                      </td>
                      <td>{a.papers.map((p) => p.subject).join("、")}</td>
                      <td>{a.reviewScope === "GRADE" ? "年级联考" : "班级阅卷"}</td>
                      <td>
                        {subs.filter((s) => s.status === "GRADED").length} / {subs.length} 份
                      </td>
                      <td>
                        <Badge variant="secondary">{a.published ? "成绩已发布" : "进行中"}</Badge>
                      </td>
                      <td>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${root}/${a.id}`}>
                            查看进度
                            <ArrowRight />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-empty-action">
            <h3>
              {query || status
                ? "没有符合条件的记录"
                : homework
                  ? "布置第一份日常练习"
                  : "安排第一场考试"}
            </h3>
            <p>先准备教学内容与班级学生，再选择科目、参与班级和评阅规则。</p>
            <Button asChild variant="outline">
              <Link href={`${root}/new`}>{homework ? "布置作业" : "安排考试"}</Link>
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}

export function AssessmentCreatePage({ id, paperId }: { id?: string; paperId?: string }) {
  const { state, mutate, pending } = useDomain();
  const { root, homework, noun } = useAssessmentPaths();
  const router = useRouter();
  const assessment = state.assessments.find((a) => a.id === id);
  const readOnly = !!assessment && state.submissions.some((s) => s.assessmentId === id);
  if (id && !assessment) return <MissingRecord back={root} />;
  return (
    <>
      <PageHeader
        title={
          readOnly
            ? `查看${homework ? "作业" : "考试"}安排`
            : `${id ? "调整" : homework ? "布置" : "安排"}${noun}`
        }
        description={
          readOnly
            ? "查看本次安排，名称可在进度概览中重命名。"
            : homework
              ? "选择练习册和参与班级，保存参与班级与本次批改设置。"
              : "选择考试试卷与班级，设置每科评阅方式和成绩赋分规则。"
        }
        back={{ href: id ? `${root}/${id}` : root, label: assessment?.name ?? `全部${noun}` }}
      />
      {readOnly && (
        <p className="p-notice" role="status">
          已有学生答卷，本次安排中的班级、科目、阅卷规则和赋分设置已锁定，只能查看。
          如需修改名称，请返回<Link href={`${root}/${id}`}>进度概览</Link>使用“重命名”。
        </p>
      )}
      {!readOnly && (!state.papers.length || !state.classrooms.length) && (
        <p className="p-notice">
          请先
          {!state.papers.length && (
            <Link href={homework ? "/homework/new" : "/exams/papers/new"}>
              创建{homework ? "作业" : "试卷"}
            </Link>
          )}
          {!state.papers.length && !state.classrooms.length ? "，并" : ""}
          {!state.classrooms.length && (
            <Link href="/workspace/classes/new">建立班级和学生名单</Link>
          )}
          。
        </p>
      )}
      <AssessmentEditor
        assessment={assessment ?? null}
        state={state}
        pending={pending}
        fixedKind={homework ? "HOMEWORK" : "EXAM"}
        initialPaperId={paperId}
        mutate={mutate}
        onSaved={(result) => {
          if (result.id) router.push(`${root}/${result.id}`);
        }}
        close={() => router.push(id ? `${root}/${id}` : root)}
      />
    </>
  );
}

export function AssessmentNavigation({ id, active }: { id: string; active: string }) {
  const { root } = useAssessmentPaths();
  return (
    <PageTabs
      active={active}
      links={[
        { href: `${root}/${id}`, label: "进度概览" },
        { href: `${root}/${id}/roster`, label: "参与名单" },
        { href: `${root}/${id}/submissions`, label: "学生作答" },
        { href: `${root}/${id}/grading`, label: "评阅进度" },
        { href: `${root}/${id}/reports`, label: "成绩报告" },
        { href: `${root}/${id}/publish`, label: "发布成绩" },
      ]}
    />
  );
}

export function AssessmentOverviewPage({ id }: { id: string }) {
  const { state } = useDomain();
  const { root, homework, noun } = useAssessmentPaths();
  const a = state.assessments.find((a) => a.id === id);
  if (!a) return <MissingRecord back={root} />;
  const subs = state.submissions.filter((s) => s.assessmentId === id);
  const roster = state.classrooms
    .filter((c) => a.classroomIds.includes(c.id))
    .flatMap((c) => c.students);
  return (
    <>
      <PageHeader
        title={a.name}
        titleEditor={<RecordNameEditor record={a} kind="assessment" noun={noun} heading />}
        description={`${homework ? "日常作业" : "考试"} · ${a.reviewScope === "GRADE" ? "年级联考 · 同届别按任教学科阅卷" : "班级阅卷 · 本班任课老师按学科阅卷"} · ${a.papers.map((p) => p.subject).join("、")} · ${a.classroomIds.length} 个班级`}
        back={{ href: root, label: homework ? "布置记录" : "全部考试" }}
        actions={
          <Button asChild variant="outline">
            <Link href={`${root}/${id}/settings`}>{subs.length ? "查看安排" : "调整安排"}</Link>
          </Button>
        }
      />
      <AssessmentNavigation id={id} active={`${root}/${id}`} />
      <div className="p-summary-strip">
        <div>
          <small>参与学生</small>
          <strong>{roster.length} 人</strong>
        </div>
        <div>
          <small>已录入</small>
          <strong>
            {subs.length} / {roster.length * a.papers.length} 份
          </strong>
        </div>
        <div>
          <small>已完成评阅</small>
          <strong>{subs.filter((s) => s.status === "GRADED").length} 份</strong>
        </div>
        <div>
          <small>发布状态</small>
          <strong>{a.published ? "已发布" : "未发布"}</strong>
        </div>
      </div>
      <div className="p-detail-grid">
        <Panel title={homework ? "本次练习册" : "考试科目与试卷"}>
          {a.papers.map((p) => (
            <div className="p-list-row" key={p.paperId}>
              <div>
                <Link href={`${homework ? "/homework" : "/exams/papers"}/${p.paperId}`}>
                  {state.papers.find((i) => i.id === p.paperId)?.name}
                </Link>
                <small>
                  {p.subject} ·{" "}
                  {
                    (state.papers.find((paper) => paper.id === p.paperId)?.items ?? []).filter(
                      (item) => reviewRule(p, item.id).doubleReview,
                    ).length
                  }{" "}
                  题双评 · {p.conversion.enabled ? "排名赋分" : "原始分"}
                </small>
              </div>
              <ArrowRight size={16} />
            </div>
          ))}
        </Panel>
        <Panel title="下一步">
          <div className="p-task-links">
            <Link href={`${root}/${id}/roster`}>
              <div>
                核对参与名单<small>查看参与班级的学生名单</small>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link
              href={`${homework ? "/homework/submissions/new" : "/exams/scanning/upload"}?assessmentId=${id}`}
            >
              <div>
                {homework ? "录入练习册" : "扫描答题卡"}
                <small>添加学生作答</small>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link href={`${root}/${id}/grading`}>
              <div>
                完成评阅<small>核对每份作答的完成情况</small>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link href={`${root}/${id}/publish`}>
              <div>
                发布成绩与反馈<small>全部完成后向学生发布</small>
              </div>
              <ArrowRight size={16} />
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function AssessmentRosterPage({ id }: { id: string }) {
  const { state } = useDomain();
  const { root } = useAssessmentPaths();
  const a = state.assessments.find((a) => a.id === id);
  if (!a) return <MissingRecord back={root} />;
  const students = state.classrooms
    .filter((c) => a.classroomIds.includes(c.id))
    .flatMap((c) => c.students.map((s) => ({ ...s, classroomName: c.name })));
  return (
    <>
      <PageHeader
        title="参与名单"
        description="参与范围以班级为单位，学生名单来自当前班级名册。"
        back={{ href: `${root}/${id}`, label: a.name }}
      />
      <AssessmentNavigation id={id} active={`${root}/${id}/roster`} />
      <Panel title={`${students.length} 位参与学生`}>
        <div className="p-table" role="region" aria-label="参与学生名单" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>学号 / 卡号</th>
                <th>班级</th>
                <th>账号绑定</th>
                <th>作答录入</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.studentNumber}</td>
                  <td>{s.classroomName}</td>
                  <td>{s.userId ? "已绑定" : "未绑定"}</td>
                  <td>
                    {
                      state.submissions.filter((i) => i.assessmentId === id && i.studentId === s.id)
                        .length
                    }{" "}
                    / {a.papers.length} 科
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function AssessmentPublishPage({ id }: { id: string }) {
  const { state, mutate, pending } = useDomain();
  const { root } = useAssessmentPaths();
  const a = state.assessments.find((a) => a.id === id);
  if (!a) return <MissingRecord back={root} />;
  const results = state.analytics.results.filter((r) => r.assessmentId === id);
  const expected = state.classrooms
    .filter((c) => a.classroomIds.includes(c.id))
    .reduce((n, c) => n + c.students.length, 0);
  const unfinished = results.filter((r) => r.total === null);
  const ready = results.length === expected && expected > 0 && !unfinished.length;
  return (
    <>
      <PageHeader
        title="发布成绩与反馈"
        description="发布后学生可查看自己的成绩、错题与学习报告。更改评分前需要先撤回发布。"
        back={{ href: `${root}/${id}`, label: a.name }}
      />
      <AssessmentNavigation id={id} active={`${root}/${id}/publish`} />
      <Panel title={a.published ? "成绩已发布" : ready ? "已具备发布条件" : "还需要完成评阅"}>
        <div className="p-panel-content">
          <div className="p-actions">
            <CheckCircle2 size={22} />
            <strong>
              {a.published
                ? "学生已可查看本人反馈"
                : `${results.filter((r) => r.total !== null).length} / ${expected} 位学生已完成全部科目评分`}
            </strong>
          </div>
          <p className="p-muted">所有参与学生的每科评阅完成后，才能一次性发布正式成绩。</p>
          {unfinished.length > 0 && (
            <div className="p-answers">
              <strong>待完成学生</strong>
              <p>{unfinished.map((r) => r.studentName).join("、")}</p>
              <Link href={`${root}/${id}/grading`}>继续完成评阅</Link>
            </div>
          )}
          <div className="p-actions" style={{ marginTop: 20 }}>
            <Button
              disabled={pending || (!a.published && !ready)}
              variant={a.published ? "outline" : "default"}
              onClick={() =>
                void mutate({ type: "assessment.publish", id, published: !a.published })
              }
            >
              {pending ? "正在更新…" : a.published ? "撤回成绩发布" : "发布成绩与学习反馈"}
            </Button>
            <Button asChild variant="outline">
              <Link href={`${root}/${id}/reports`}>检查成绩报告</Link>
            </Button>
          </div>
        </div>
      </Panel>
    </>
  );
}

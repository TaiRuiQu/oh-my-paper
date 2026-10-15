"use client";
import Link from "next/link";
import { useDomain } from "./domain-provider";
import { PageHeader } from "./page-header";
import { Panel } from "./primitives";
import { Admin } from "./admin";
import { PlatformAI } from "./ai";

export function AdminPage({
  view = "overview",
}: {
  view?: "overview" | "users" | "models" | "jobs";
}) {
  const { state, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title={
          { overview: "系统报表", users: "账号与权限", models: "AI 模型接入", jobs: "AI 任务记录" }[
            view
          ]
        }
        description={
          {
            overview: "查看平台教学资源和账号分布，进入具体管理页面处理配置。",
            users:
              "管理账号与教师的教学身份，按全校、届别、班级和学科分配数据权限。学生只能查看本人学习数据。",
            models: "维护 AI 模型接入、向量化模型与题库语义搜索索引。",
            jobs: "跟进自主 Agent 的执行状态，查看结果和失败原因。",
          }[view]
        }
      />
      {view === "overview" ? (
        <>
          <div className="p-summary-strip">
            <div>
              <small>账号总数</small>
              <strong>{state.users.length}</strong>
            </div>
            <div>
              <small>班级</small>
              <strong>{state.classrooms.length}</strong>
            </div>
            <div>
              <small>试题</small>
              <strong>{state.questionCount ?? state.questions.length}</strong>
            </div>
            <div>
              <small>考试与作业安排</small>
              <strong>{state.assessments.length}</strong>
            </div>
          </div>
          <Panel title="教学数据汇总">
            <div className="p-table" role="region" aria-label="系统教学报表" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>业务</th>
                    <th>内容总量</th>
                    <th>已布置</th>
                    <th>已发布成绩</th>
                    <th>已录入作答</th>
                  </tr>
                </thead>
                <tbody>
                  {(["EXAM", "HOMEWORK"] as const).map((kind) => (
                    <tr key={kind}>
                      <td>{kind === "EXAM" ? "考试" : "作业"}</td>
                      <td>{state.papers.filter((p) => p.kind === kind).length}</td>
                      <td>{state.assessments.filter((a) => a.kind === kind).length}</td>
                      <td>
                        {state.assessments.filter((a) => a.kind === kind && a.published).length}
                      </td>
                      <td>
                        {
                          state.submissions.filter((s) =>
                            state.assessments.some(
                              (a) => a.id === s.assessmentId && a.kind === kind,
                            ),
                          ).length
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="系统管理">
            <div className="p-task-links">
              <Link href="/admin/users">
                账号角色管理<span>{state.users.length} 个账号</span>
              </Link>
              <Link href="/admin/models">
                AI 与向量化模型配置<span>进入配置</span>
              </Link>
              <Link href="/admin/jobs">
                后台 AI 任务<span>查看执行状态</span>
              </Link>
            </div>
          </Panel>
        </>
      ) : view === "jobs" ? (
        <PlatformAI state={state} tab="overview" refresh={refresh} notify={notify} />
      ) : (
        <Admin state={state} refresh={refresh} notify={notify} section={view} />
      )}
    </>
  );
}

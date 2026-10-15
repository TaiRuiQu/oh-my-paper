"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiJobDTO, BatchGradingResult } from "@/contracts/platform-ai";
import type { PlatformState } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { aiJobHref } from "@/lib/ai-job-display";
import { Panel } from "./primitives";

export function BatchGradingResults({
  job,
  result,
  state,
}: {
  job: AiJobDTO;
  result: BatchGradingResult;
  state: PlatformState;
}) {
  const router = useRouter();
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const classroom = state.classrooms.find((c) => c.id === result.classroomId);
  const base = result.assessmentKind === "HOMEWORK" ? "/homework" : "/exams";
  const selected = result.pendingPages.filter((p) => bindings[p.sourceUrl]);
  async function retryConfirmed() {
    setBusy(true);
    setError("");
    try {
      const next = await apiRequest<{ id: string }>("/api/platform/ai", {
        method: "POST",
        ...jsonBody({
          kind: "BATCH_GRADE",
          modelId: job.modelId,
          input: {
            assessmentId: result.assessmentId,
            classroomId: result.classroomId,
            paperId: result.paperId,
            ...(result.templateId ? { templateId: result.templateId } : {}),
            assetUrls: selected.map((p) => p.sourceUrl),
            studentHints: selected.map((p) => ({
              sourceUrl: p.sourceUrl,
              studentId: bindings[p.sourceUrl],
            })),
          },
        }),
      });
      router.push(aiJobHref(next.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!!result.students.length && (
        <Panel title={`已处理 ${result.students.length} 位学生`}>
          <div className="p-table" role="region" aria-label="班级批改结果" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>学生</th>
                  <th>已评分</th>
                  <th>待核对</th>
                  <th>作答与评分</th>
                </tr>
              </thead>
              <tbody>
                {result.students.map((student) => (
                  <tr key={student.studentId}>
                    <td>{student.name}</td>
                    <td>{student.gradedQuestions} 题</td>
                    <td>{student.skippedQuestions} 题</td>
                    <td>
                      <Link href={`${base}/grading/${encodeURIComponent(student.submissionId)}`}>
                        核对批改
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {!!result.pendingPages.length && (
        <Panel
          title={`待确认学生 · ${result.pendingPages.length} 页`}
          description="查看原图并确认学生。同一学生的全部页面选择同一姓名，再一起提交；其余已完成的评分保留。"
        >
          <div className="p-table" role="region" aria-label="待确认学生材料" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>扫描页</th>
                  <th>待确认原因</th>
                  <th>归属学生</th>
                </tr>
              </thead>
              <tbody>
                {result.pendingPages.map((page, index) => (
                  <tr key={page.sourceUrl}>
                    <td>
                      <a href={page.sourceUrl} target="_blank" rel="noreferrer">
                        查看第 {index + 1} 页原图
                      </a>
                    </td>
                    <td>{page.reason}</td>
                    <td>
                      <select
                        disabled={busy}
                        aria-label={`第 ${index + 1} 页归属学生`}
                        value={bindings[page.sourceUrl] ?? ""}
                        onChange={(e) =>
                          setBindings((current) => ({
                            ...current,
                            [page.sourceUrl]: e.target.value,
                          }))
                        }
                      >
                        <option value="">待确认</option>
                        {classroom?.students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.studentNumber} · {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-panel-content">
            {error && (
              <p role="alert" className="p-notice error">
                {error}
              </p>
            )}
            <button
              className="button"
              disabled={busy || !selected.length}
              onClick={() => void retryConfirmed()}
            >
              {busy ? "正在提交…" : `确认并批改所选 ${selected.length} 页`}
            </button>
          </div>
        </Panel>
      )}
    </>
  );
}

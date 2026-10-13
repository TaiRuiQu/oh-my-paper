"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { examQuestionCount, type Exam } from "@/contracts/exams";
import type { ExamAgentTask, ExamAgentsDetail, GradedAnswer } from "@/contracts/exam-agents";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { reportClientError, taskErrorMessage } from "@/lib/error-message";
import { submitExamUpload } from "@/lib/exam-upload";
import type { TaskModelSelection } from "@/contracts/user-ai";
import { TaskModelPicker, useTaskModelSettings } from "./task-model-picker";
import { FileUpload } from "./file-upload";
import { MarkdownText } from "./markdown-text";
import { RecognitionActivityFeed } from "./recognition-activity";
import { ProcessingState } from "./processing-state";
export function ExamAgents({
  exam,
  taskId,
  isAdmin,
}: {
  exam: Exam;
  taskId: string;
  isAdmin: boolean;
}) {
  const modelQuery = useTaskModelSettings();
  const [models, setModels] = useState<TaskModelSelection>({});
  const client = useQueryClient(),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [progress, setProgress] = useState(0);
  const request = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const query = useQuery({
    queryKey: ["exam-agents", taskId],
    queryFn: () => apiRequest<ExamAgentsDetail>(`/api/exams/${taskId}/agents`),
    refetchInterval: (query) =>
      query.state.data?.tasks.some((task) => ["QUEUED", "RUNNING"].includes(task.status)) ||
      ["QUEUED", "RUNNING"].includes(query.state.data?.upload?.status ?? "")
        ? 2000
        : false,
  });
  const answers = (query.data?.tasks ?? []).filter((task) => task.kind === "ANSWER");
  const running = answers.find((task) => ["QUEUED", "RUNNING"].includes(task.status));
  const attachedUpload = query.data?.upload;
  const waiting = !!attachedUpload && ["QUEUED", "RUNNING"].includes(attachedUpload.status);
  const latest = answers[0],
    completed = answers.find((task) => task.status === "COMPLETED");
  async function start(path: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/exams/${taskId}/${path}`, {
        method: "POST",
        ...(path === "solutions" || path.startsWith("agents/")
          ? jsonBody({ modelId: models.answer, reasoningEffort: models.reasoningEfforts?.answer })
          : {}),
      });
      await client.invalidateQueries({ queryKey: ["exam-agents", taskId] });
      await client.invalidateQueries({ queryKey: ["exams"] });
    } catch (error) {
      const message = reportClientError("answer.start", error);
      setError(isAdmin ? message : taskErrorMessage(error, "暂时无法生成标准答案，请稍后重试。"));
    } finally {
      setPending(false);
    }
  }
  async function uploadAnswers(event: FormEvent) {
    event.preventDefault();
    if (pending || running || waiting || !files.length) return;
    setPending(true);
    setError("");
    setProgress(0);
    try {
      await submitExamUpload({
        files,
        models: { answer: models.answer, reasoningEfforts: models.reasoningEfforts },
        endpoint: `/api/exams/${taskId}/answers/upload`,
        onProgress: setProgress,
        onRequest: (xhr) => {
          request.current = xhr;
        },
      });
      await client.invalidateQueries({ queryKey: ["exam-agents", taskId] });
      await client.invalidateQueries({ queryKey: ["exams"] });
      setUploading(false);
      setFiles([]);
    } catch (error) {
      const message = reportClientError("answer.upload", error);
      setError(isAdmin ? message : taskErrorMessage(error, "标准答案提交失败，请检查文件后重试。"));
    } finally {
      request.current = null;
      setPending(false);
    }
  }
  return (
    <section aria-labelledby="answer-heading">
      <div className="section-heading">
        <div>
          <h2 id="answer-heading">标准答案</h2>
          <p className="intro">上传已有标准答案，或让 AI 自动生成；准备完成后即可用于批改。</p>
        </div>
        <div className="inline-actions">
          <button
            className="button secondary"
            disabled={
              pending ||
              !!running ||
              waiting ||
              query.isPending ||
              modelQuery.isPending ||
              !!modelQuery.error
            }
            aria-expanded={uploading}
            aria-controls="upload-reference-answers"
            onClick={() => setUploading(!uploading)}
          >
            {uploading ? "收起上传" : "上传标准答案"}
          </button>
          <button
            className="button"
            disabled={
              pending ||
              !!running ||
              waiting ||
              query.isPending ||
              modelQuery.isPending ||
              !!modelQuery.error
            }
            onClick={() => void start("solutions")}
          >
            {running || waiting ? "处理中" : completed ? "重新生成" : "生成标准答案"}
          </button>
        </div>
      </div>
      <TaskModelPicker
        query={modelQuery}
        purposes={["answer"]}
        value={models}
        onChange={setModels}
        disabled={pending || !!running || waiting}
      />
      {uploading && (
        <form
          id="upload-reference-answers"
          className="reference-upload"
          onSubmit={uploadAnswers}
          aria-busy={pending}
        >
          <h3>上传标准答案并解析</h3>
          <p className="hint">按试卷题号匹配已有答案，不重新生成。请上传覆盖全部题目的清晰答案。</p>
          <FileUpload
            id="answer-key-files"
            files={files}
            onChange={setFiles}
            disabled={pending || !!running}
            onError={setError}
            student={false}
            label="选择标准答案或拖放到这里"
          />
          <div className="upload-actions">
            <button
              className="button"
              disabled={
                pending || !!running || !files.length || modelQuery.isPending || !!modelQuery.error
              }
            >
              {pending ? `正在上传 ${progress}%` : "上传并解析答案"}
            </button>
          </div>
          {pending && <progress value={progress} max={100} aria-label="答案上传进度" />}
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {query.error && (
        <p role="alert" className="form-error">
          {isAdmin ? query.error.message : "答案暂时无法加载。"}
          <button className="button secondary" onClick={() => void query.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {(query.isPending || running || waiting) && (
        <ProcessingState
          title={query.isPending ? "正在加载" : "正在处理，请稍候"}
          creditLabel={isAdmin ? "折算用量" : "已消费"}
          creditsSpent={query.isPending ? undefined : (running?.creditsSpent ?? "0")}
          startedAt={running?.createdAt ?? (waiting ? attachedUpload?.createdAt : undefined)}
          progress={
            running
              ? [
                  {
                    label: running.answerSource === "UPLOAD" ? "已解析答案" : "已生成答案",
                    total: running.progress?.total ?? examQuestionCount(exam),
                    completed:
                      running.progress?.completed ??
                      (isAdmin ? running.result.questions.length : 0),
                  },
                ]
              : waiting
                ? [{ label: "已解析答案", total: examQuestionCount(exam), completed: 0 }]
                : undefined
          }
        />
      )}
      {attachedUpload?.status === "FAILED" && (
        <div className="recovery-notice">
          <p role="alert">已上传的标准答案未能开始处理，请重试。你也可以重新上传。</p>
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => void start("answers/upload/retry")}
          >
            重试解析
          </button>
        </div>
      )}
      {latest?.status === "FAILED" && (
        <div className="recovery-notice">
          <p role="alert">
            {isAdmin
              ? latest.error
              : "这次答案处理未能完成，请重试或重新上传清晰、完整的答案。已有标准答案仍可使用。"}
          </p>
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => void start(`agents/${latest.id}/retry`)}
          >
            {latest.answerSource === "UPLOAD" ? "重试解析" : "重试生成"}
          </button>
        </div>
      )}
      {!query.isPending &&
        !running &&
        !waiting &&
        attachedUpload?.status !== "FAILED" &&
        !completed &&
        latest?.status !== "FAILED" && (
          <div className="empty-state">
            <h3>为这套试卷准备标准答案</h3>
            <p>上传已有标准答案，或点击「生成标准答案」，完成后即可用于批改答卷。</p>
          </div>
        )}
      {completed && <AgentResultContent task={completed} exam={exam} />}
      {isAdmin &&
        answers.map((task) => (
          <details className="debug-disclosure" key={task.id}>
            <summary>
              管理员调试 · 标准答案 · {task.status} · 已保存 {task.result.questions.length} 题
            </summary>
            {task.status !== "COMPLETED" && (
              <>
                <p className="hint">已保存草稿，完成前可能修订。</p>
                <AgentResultContent task={task} exam={exam} />
              </>
            )}
            <RecognitionActivityFeed
              task={task}
              baseURL={`/api/exams/${taskId}/agents/${task.id}/activity`}
              title="答案执行记录"
            />
          </details>
        ))}
    </section>
  );
}
export function AgentResultContent({ task, exam }: { task: ExamAgentTask; exam: Exam }) {
  const names = new Map(
    exam.sections.flatMap((section) =>
      section.questions.map(
        (question) => [question.id, `${section.number}、第 ${question.number} 题`] as const,
      ),
    ),
  );
  return (
    <div className="agent-result-content">
      {task.kind === "GRADING" && <GradeSummary task={task} total={names.size} />}
      <ol className="question-list">
        {task.result.questions.map((item) => (
          <li className="exam-question" key={item.questionId}>
            <div className="question-heading">
              <h3>{names.get(item.questionId)}</h3>
              {"correct" in item && (
                <span
                  className={`grade-outcome ${item.correct === true ? "is-correct" : item.correct === null ? "is-review" : "is-incorrect"}`}
                >
                  {item.correct === null ? "需要复核" : item.correct ? "正确" : "未完全正确"} ·{" "}
                  {item.score === null ? "未评分" : `${item.score} 分`}
                </span>
              )}
            </div>
            {"solution" in item ? (
              <div className="answer-columns">
                <div>
                  <h4>参考解答</h4>
                  <MarkdownText text={item.solution} />
                </div>
                <div className="criteria-column">
                  <h4>评分标准</h4>
                  <MarkdownText text={item.gradingCriteria} />
                </div>
              </div>
            ) : (
              <div className="answer-columns">
                <div>
                  <h4>学生作答</h4>
                  <MarkdownText text={item.answer || "未作答"} />
                </div>
                <div className="criteria-column">
                  <h4>批改反馈</h4>
                  <MarkdownText text={item.feedback} />
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
function GradeSummary({ task, total }: { task: ExamAgentTask; total: number }) {
  const grades = task.result.questions as GradedAnswer[],
    uncertain = grades.filter((item) => item.correct === null).length,
    unscored = grades.filter((item) => item.score === null).length,
    complete = task.status === "COMPLETED" && grades.length === total && !unscored;
  return (
    <div className="grade-summary" role="status">
      <div>
        <span>{complete ? "总得分" : "已评分题目合计"}</span>
        <strong>
          {grades.reduce((sum, item) => sum + (item.score ?? 0), 0)}
          <small> 分</small>
        </strong>
      </div>
      <p>
        {grades.length} 道题目{uncertain ? ` · ${uncertain} 题需要复核` : ""}
        {unscored ? ` · ${unscored} 题未评分` : ""}
      </p>
    </div>
  );
}

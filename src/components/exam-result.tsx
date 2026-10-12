"use client";
/* Image dimensions come from authenticated original scans and saved crops. */
/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarkdownText } from "./markdown-text";
import { QuestionEditor } from "./question-editor";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { GradeTaskSummary } from "@/contracts/grading";
import type { ContentBlock } from "@/contracts/exams";
import type { ExamTaskDetail, ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";
import { findFigureAsset, regionsEqual } from "@/lib/figure-assets";

const statusText = {
  verified: "识别完成",
  needs_review: "有内容需要人工核对",
  partial: "部分页面未完成识别",
};
const annotationLabels = {
  student_answer: "学生作答",
  reference_answer: "参考答案",
  teacher_annotation: "教师批注",
  rubric: "评分标准",
};
const phaseText: Record<string, string> = {
  inventory: "正在结合全卷识别大题、小题和分值。",
  localization: "正在逐题定位整题与非文字材料。",
  transcription: "正在将整题切片转成文字，并插入材料图片。",
  references: "正在提取文件中的参考答案。",
  answer_parsing: "正在结合题套结构解析完整作答。",
  solving: "正在独立解题，保存标准答案、选项和解析。",
  queued: "试卷已提交，等待后台开始识别。",
  preparing: "正在转换文件并准备清晰的页面图像。",
  parsing: "正在识别题干、选项、公式和配图。",
  verifying: "正在对照原图核对识别内容。",
  saved: "题套与标准答案已保存。",
  failed: "当前页未完成，正在保留可恢复的内容。",
};

export function ExamResult({ initialTask }: { initialTask: ExamTaskSummary }) {
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"questions" | "annotations">("questions");
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState("");
  const data = useQuery({
    queryKey: ["exam", initialTask.id],
    queryFn: () => apiRequest<ExamTaskDetail>(`/api/exams/${initialTask.id}`),
    refetchInterval: (query) =>
      !query.state.data ||
      ["QUEUED", "RUNNING"].includes(query.state.data.task.status)
        ? 2500
        : false,
  });
  const task = data.data?.task ?? initialTask;
  const exam = data.data?.exam;
  const grades = useQuery({
    queryKey: ["grade-history", task.id],
    queryFn: () =>
      apiRequest<{ tasks: GradeTaskSummary[] }>(`/api/exams/${task.id}/grades`),
    enabled: task.status === "COMPLETED" && !!task.autoGrade,
    refetchInterval: (query) =>
      !query.state.data?.tasks.length ||
      query.state.data.tasks.some((t) =>
        ["QUEUED", "RUNNING"].includes(t.status),
      )
        ? 2500
        : false,
  });
  const automaticGrade = grades.data?.tasks[0];

  const images = data.data?.mathImages ?? {};
  const fileURL = (key: string) =>
    `/api/exams/${task.id}/files/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function cancel() {
    setActionError("");
    try {
      await apiRequest(`/api/exams/${task.id}/cancel`, { method: "POST" });
      await data.refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "取消未成功，请重试。");
    }
  }
  async function retry() {
    setRetrying(true);
    setActionError("");
    try {
      await apiRequest(`/api/exams/${task.id}/retry`, { method: "POST" });
      await data.refetch();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "提交失败，请重试。",
      );
    } finally {
      setRetrying(false);
    }
  }
  async function generateSolutions() {
    setRetrying(true); setActionError("");
    try {
      await apiRequest(`/api/exams/${task.id}/solutions`, { method: "POST" });
      await data.refetch();
    } catch (error) { setActionError(error instanceof Error ? error.message : "答案生成未能提交，请重试。"); }
    finally { setRetrying(false); }
  }
  function math(latex: string) {
    // SVGs are displayed in the browser's isolated image context, never inserted as HTML.
    return typeof images[latex] === "string" ? (
      <img className="math-image" src={images[latex]} alt={latex} />
    ) : (
      <code className="math-fallback">{latex}</code>
    );
  }
  function textWithMath(text: string) {
    const pieces: ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
      pieces.push(
        text.slice(cursor, match.index),
        <span key={match.index}>{math(match[1] ?? match[2])}</span>,
      );
      cursor = match.index + match[0].length;
    }
    pieces.push(text.slice(cursor));
    return pieces;
  }
  function blocks(content: ContentBlock[], keyPrefix: string) {
    return content.map((block, index) => {
      const key = `${keyPrefix}-${index}`;
      if (block.type === "text")
        return <MarkdownText key={key} text={block.text} images={images} />;
      if (block.type === "math")
        return (
          <div className="math-block" key={key}>
            {math(block.latex)}
          </div>
        );
      if (block.type === "table")
        return (
          <div className="table-scroll" key={key}>
            <table>
              <caption className="sr-only">试卷表格</caption>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{textWithMath(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      const asset = findFigureAsset(exam?.assets ?? [], block);
      return (
        <figure className="exam-figure" key={key}>
          {asset?.cleanKey ? (
            <>
              <img
                src={fileURL(asset.cleanKey)}
                alt={block.caption}
                loading="lazy"
              />
            </>
          ) : (
            <p className="review-note">
              配图需核对，请查看原图
              {asset && (
                <>
                  或
                  <Link href={fileURL(asset.evidenceKey)} target="_blank">
                    查看图形证据
                  </Link>
                </>
              )}
              。
            </p>
          )}
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    });
  }
  const currentPage =
    exam?.pages.find((item) => item.page === page) ?? exam?.pages[0];
  const selectedPage = currentPage?.page ?? page;
  const questions =
    exam?.questions.filter((question) =>
      question.regions.some((region) => region.page === selectedPage),
    ) ?? [];
  const activeQuestion =
    questions.find((q) => q.id === selectedQuestion) ?? questions[0];
  const visibleQuestions = activeQuestion ? [activeQuestion] : questions;
  const materials =
    exam?.materials.filter(
      (material) =>
        material.regions.some((region) => region.page === selectedPage) ||
        visibleQuestions.some((q) => q.materialRefs.includes(material.key)),
    ) ?? [];

  return (
    <>
      <Link href="/dashboard" className="back-link">
        返回试卷板块
      </Link>
      <div className="workspace-heading result-heading">
        <h1>{exam?.title || task.name}</h1>
        <p className="intro">
          {exam
            ? `${exam.pages.length} 页 · ${exam.inventory?.sections.length ?? new Set(exam.questions.map((q) => q.section)).size} 大题 · ${exam.questions.length} 道题 · ${exam.questions.reduce((n, q) => n + q.parts.length, 0)} 小题 · ${exam.questions.some((q) => q.points === null) ? "部分分值待核对" : `${exam.questions.reduce((n, q) => n + (q.points ?? 0), 0)} 分`}`
            : "正在处理你的试卷"}
        </p>
      </div>
      {data.error && (
        <div className="review-note" role="alert">
          <p>暂时无法加载最新结果，请重试。</p>
          <button className="text-button" onClick={() => void data.refetch()}>
            重新加载
          </button>
        </div>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {["QUEUED", "RUNNING"].includes(task.status) && (
        <section
          className="recognition-progress"
          aria-labelledby="progress-heading"
          role="status"
        >
          <h2 id="progress-heading">
            {task.status === "QUEUED" ? "等待识别" : "正在识别试卷"}
          </h2>
          <p>{phaseText[task.phase] ?? "正在处理试卷。"}</p>
          {task.totalPages > 0 && (
            <>
              <progress
                max={task.totalPages}
                value={task.page}
                aria-label={
                  ["parsing", "localization", "transcription", "solving"].includes(task.phase)
                    ? "已处理题目"
                    : "已处理页面"
                }
              />
              <p className="hint">
                已处理 {task.page} / {task.totalPages}{" "}
                {["parsing", "localization", "transcription", "solving"].includes(task.phase)
                  ? "题"
                  : "页"}
              </p>
            </>
          )}
          <p className="hint">
            多页试卷可能需要几分钟。你可以离开页面，后台会继续处理。
          </p>
          {task.status === "QUEUED" && (
            <p className="hint">若长时间没有开始，请联系管理员检查处理服务。</p>
          )}
          <button className="text-button" onClick={() => void cancel()}>
            取消处理
          </button>
        </section>
      )}
      {task.status === "FAILED" && (
        <section
          className="recognition-progress"
          aria-labelledby="failure-heading"
        >
          <h2 id="failure-heading">识别未完成</h2>
          <p className="form-error">{task.error}</p>
          <button
            className="button"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? "正在提交…" : "重新识别"}
          </button>
          <p className="hint">请确认文件清晰、完整，再重新提交。</p>
        </section>
      )}
      {task.status === "COMPLETED" && !exam && !data.error && (
        <p className="setup-note" role="status">
          正在加载识别结果…
        </p>
      )}
      {exam && (
        <>
          {task.autoGrade && (
            <div className="auto-grade-notice" role="status">
              {automaticGrade ? (
                <>
                  <strong>
                    {automaticGrade.status === "COMPLETED"
                      ? "作答已批改"
                      : automaticGrade.status === "FAILED"
                        ? "批改未完成"
                        : "正在批改作答"}
                  </strong>
                  <Link href={`/grades/${automaticGrade.id}`}>
                    {automaticGrade.status === "COMPLETED"
                      ? "查看逐题报告与得分"
                      : "查看批改进度"}
                  </Link>
                </>
              ) : (
                <span>{exam.questions.some((q) => !q.solution?.sufficient) ? "标准答案尚未完整，请补充或生成答案后再批改。" : "识别完成，正在准备批改任务。"}</span>
              )}
            </div>
          )}
          <div className="result-toolbar">
            <div>
              <strong>{statusText[exam.verification.status]}</strong>
              <p className="hint">
                逐题对照原卷与切片，标准答案将用于后续批改。
              </p>
            </div>
            <div className="inline-actions">
              {exam.questions.some((q) => !q.solution?.sufficient) && (
                <Button variant="outline" disabled={retrying} onClick={() => void generateSolutions()}>
                  {retrying ? "正在提交…" : "补生成标准答案"}
                </Button>
              )}
              {!!exam.questions.length && (
                <Link className="button" href={`/exams/${task.id}/grade`}>
                  开始批改
                </Link>
              )}
              {!!exam.questions.length && !task.autoGrade && (
                <Link className="button secondary" href={`/grading?templateId=${encodeURIComponent(task.id)}`}>
                  上传本题套的作答
                </Link>
              )}
              <details className="technical-download">
                <summary>更多下载</summary>
                <a href={`${fileURL("exam.json")}?download`}>结构化数据</a>
                <br />
                <a href={`${fileURL("exam.md")}?download`}>文本与公式</a>
              </details>
            </div>
          </div>
          {!!exam.verification.findings.length && (
            <details className="review-findings">
              <summary>
                {exam.verification.findings.length} 条待核对提示
              </summary>
              <ul>
                {exam.verification.findings.map((finding, index) => (
                  <li key={index}>
                    <button
                      className="text-button"
                      onClick={() => setPage(finding.page)}
                    >
                      第 {finding.page} 页
                      {finding.questionNumber
                        ? ` · 第 ${finding.questionNumber} 题`
                        : ""}
                    </button>
                    <p>
                      {finding.severity === "error"
                        ? "本处内容未能完整识别，请对照原图核对。"
                        : "本处识别内容可能有误，请对照原图确认。"}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="result-controls">
            <label htmlFor="source-page">
              查看页面{" "}
              <select
                id="source-page"
                value={selectedPage}
                onChange={(e) => setPage(Number(e.target.value))}
              >
                {exam.pages.map((page) => (
                  <option key={page.page} value={page.page}>
                    第 {page.page} 页
                    {page.status === "failed" ? "（识别失败）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="inline-actions"
              role="group"
              aria-label="识别内容类型"
            >
              <button
                className={`tab-button${tab === "questions" ? " is-active" : ""}`}
                aria-pressed={tab === "questions"}
                onClick={() => setTab("questions")}
              >
                题目与材料
              </button>
              <button
                className={`tab-button${tab === "annotations" ? " is-active" : ""}`}
                aria-pressed={tab === "annotations"}
                onClick={() => setTab("annotations")}
              >
                作答与批注
              </button>
            </div>
          </div>
          {tab === "questions" && !!questions.length && (
            <div className="question-index" aria-label="选择题目">
              {questions.map((q) => (
                <Button
                  variant={activeQuestion?.id === q.id ? "default" : "outline"}
                  key={q.id}
                  aria-pressed={activeQuestion?.id === q.id}
                  onClick={() => setSelectedQuestion(q.id)}
                >
                  第 {q.number} 题{q.points !== null ? ` · ${q.points} 分` : ""}
                </Button>
              ))}
            </div>
          )}
          <div className="exam-comparison">
            <section className="source-panel" aria-labelledby="source-heading">
              <div className="section-heading">
                <h2 id="source-heading">原图 · 第 {selectedPage} 页</h2>
                {currentPage && (
                  <a
                    href={fileURL(currentPage.key)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    放大查看
                  </a>
                )}
              </div>
              {currentPage && (
                <div className="source-canvas">
                  <img
                    className="source-image"
                    src={fileURL(currentPage.key)}
                    alt={`试卷第 ${selectedPage} 页原图`}
                  />
                  {tab === "questions" &&
                    questions.flatMap((q) =>
                      q.regions
                        .filter((r) => r.page === selectedPage)
                        .map((r, index) => (
                          <button
                            key={`${q.id}-${index}`}
                            className={`question-box${activeQuestion?.id === q.id ? " selected" : ""}`}
                            style={{
                              left: `${r.x * 100}%`,
                              top: `${r.y * 100}%`,
                              width: `${r.width * 100}%`,
                              height: `${r.height * 100}%`,
                            }}
                            onClick={() => setSelectedQuestion(q.id)}
                            aria-label={`查看第 ${q.number} 题切片`}
                            aria-pressed={activeQuestion?.id === q.id}
                          >
                            <span>第 {q.number} 题</span>
                          </button>
                        )),
                    )}
                  {tab === "questions" &&
                    activeQuestion &&
                    exam.assets
                      .filter(
                        (a) =>
                          visibleQuestions.some((q) =>
                            [
                              ...q.blocks,
                              ...q.options.flatMap((o) => o.blocks),
                              ...q.parts.flatMap((p) => p.blocks),
                              ...materials.flatMap((m) => m.blocks),
                            ].some(
                              (b) =>
                                b.type === "figure" &&
                                regionsEqual(b.region, a.region),
                            ),
                          ) && a.region.page === selectedPage,
                      )
                      .map((asset) => (
                        <span
                          key={asset.id}
                          className="figure-box"
                          style={{
                            left: `${asset.region.x * 100}%`,
                            top: `${asset.region.y * 100}%`,
                            width: `${asset.region.width * 100}%`,
                            height: `${asset.region.height * 100}%`,
                          }}
                        >
                          <span>材料图</span>
                        </span>
                      ))}
                </div>
              )}
            </section>
            <section className="slice-panel" aria-labelledby="slice-heading">
              <h2 id="slice-heading">
                题目切片
                {activeQuestion ? ` · 第 ${activeQuestion.number} 题` : ""}
              </h2>
              <p className="hint">保留完整题目范围，可与原卷对照。</p>
              {activeQuestion?.crops?.length ? (
                activeQuestion.crops.map((crop, index) => (
                  <figure className="question-slice" key={crop.key}>
                    <img
                      src={fileURL(crop.key)}
                      alt={`第 ${activeQuestion.number} 题第 ${index + 1} 个切片`}
                    />
                    <figcaption>
                      第 {crop.region.page} 页 ·{" "}
                      <a
                        href={fileURL(crop.key)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看切片
                      </a>
                    </figcaption>
                  </figure>
                ))
              ) : (
                <p className="setup-note muted">
                  {activeQuestion
                    ? "当前存稿未保存切片，可重新识别生成。"
                    : "请选择含题目的页面。"}
                </p>
              )}
              {activeQuestion && (
                <div className="slice-materials">
                  <h3>材料与题图</h3>
                  {exam.assets
                    .filter((a) =>
                      [
                        ...activeQuestion.blocks,
                        ...activeQuestion.options.flatMap((o) => o.blocks),
                        ...activeQuestion.parts.flatMap((p) => p.blocks),
                        ...materials.flatMap((m) => m.blocks),
                      ].some(
                        (b) =>
                          b.type === "figure" &&
                          regionsEqual(b.region, a.region),
                      ),
                    )
                    .map((asset) => (
                      <figure className="exam-figure" key={asset.id}>
                        <img
                          src={fileURL(asset.evidenceKey)}
                          alt={asset.caption}
                          loading="lazy"
                        />
                        <figcaption>
                          {asset.caption} ·{" "}
                          <a href={fileURL(asset.evidenceKey)} download>
                            保存图片
                          </a>
                        </figcaption>
                      </figure>
                    ))}
                </div>
              )}
            </section>
            <section
              className="transcription-panel"
              aria-labelledby="transcription-heading"
            >
              <h2 id="transcription-heading">
                {tab === "questions" ? "识别内容" : "作答与批注"}
              </h2>
              {tab === "questions" ? (
                <>
                  {selectedPage === 1 && !!exam.instructions.length && (
                    <div className="exam-instructions">
                      {exam.instructions.map((instruction, index) => (
                        <p key={index}>{textWithMath(instruction)}</p>
                      ))}
                    </div>
                  )}
                  {materials.map((material) => (
                    <article className="exam-material" key={material.key}>
                      <h3>{material.title || "共用材料"}</h3>
                      {blocks(material.blocks, material.key)}
                    </article>
                  ))}
                  {visibleQuestions.map((question) => (
                    <article className="exam-question" key={question.id}>
                      <div className="section-heading">
                        <h3>
                          {question.section && (
                            <span className="muted">{question.section} · </span>
                          )}
                          第 {question.number} 题
                          {question.points !== null && (
                            <span className="hint">
                              （{question.points} 分）
                              {question.pointsOrigin === "inferred" && <span className="hint"> · 推测分值</span>}
                            </span>
                          )}
                        </h3>
                        {question.status === "needs_review" && (
                          <span className="status-tag warning">需核对</span>
                        )}
                      </div>
                      {blocks(question.blocks, question.id)}
                      {question.options.map((option) => (
                        <div className="exam-option" key={option.label}>
                          <strong>{option.label}.</strong>
                          <div>
                            {blocks(
                              option.blocks,
                              `${question.id}-${option.label}`,
                            )}
                          </div>
                        </div>
                      ))}
                      {question.parts.map((part, index) => (
                        <div className="exam-part" key={index}>
                          <strong>
                            {part.parentLabel ? `${part.parentLabel} ` : ""}
                            {part.label}
                          </strong>
                          {blocks(part.blocks, `${question.id}-part-${index}`)}
                        </div>
                      ))}
                      {question.regions.length > 1 && (
                        <p className="hint">
                          本题涉及第{" "}
                          {[
                            ...new Set(question.regions.map((r) => r.page)),
                          ].join("、")}{" "}
                          页，请结合原图核对。
                        </p>
                      )}
                      <section className="solution-panel">
                        <div className="section-heading">
                          <h3>标准答案与解析</h3>
                          <Badge variant="secondary">
                            {question.solution?.sufficient
                              ? question.solution.origin === "teacher"
                                ? "参考答案已保存"
                                : "已保存"
                              : "待补充"}
                          </Badge>
                        </div>
                        {question.solution?.sufficient ? (
                          <>
                            <div className="solution-answer">
                              <strong>
                                标准答案
                                {question.solution.selectedOptions.length
                                  ? ` · ${question.solution.selectedOptions.join("、")}`
                                  : ""}
                              </strong>
                              <MarkdownText
                                text={question.solution.answer}
                                images={images}
                              />
                            </div>
                            <h4>解题解析</h4>
                            <MarkdownText
                              text={question.solution.explanation}
                              images={images}
                            />
                            {(question.solution.units?.length ?? 0) > 1 && (
                              <details>
                                <summary>逐小问与填空答案</summary>
                                {question.solution.units!.map((unit) => {
                                  const target = question.answerTargets?.find((t) => t.key === unit.targetKey);
                                  const label = target ? `${target.parentLabel ?? ""}${target.partLabel ?? ""}${target.blankIndex ? ` 第 ${target.blankIndex} 空` : ""}` : unit.targetKey;
                                  return <div className="exam-part" key={unit.targetKey}><strong>{label || unit.targetKey}</strong>
                                    <MarkdownText text={unit.answer} images={images} /><MarkdownText text={unit.explanation} images={images} />
                                  </div>;
                                })}
                              </details>
                            )}
                            <details>
                              <summary>评分标准</summary>
                              <MarkdownText
                                text={question.solution.rubric}
                                images={images}
                              />
                            </details>
                          </>
                        ) : (
                          <p className="hint">
                            本题尚无可复用的标准答案，请通过下方编辑补充。
                          </p>
                        )}
                      </section>
                      {task.outputKey && (
                        <QuestionEditor
                          key={`${question.id}-${task.outputKey}`}
                          question={question}
                          examId={task.id}
                          outputKey={task.outputKey}
                          onSaved={() => data.refetch()}
                        />
                      )}
                    </article>
                  ))}
                  {!questions.length && !materials.length && (
                    <p className="setup-note muted">
                      本页没有识别出题目。若为答题卡或答案页，可切换到“作答与批注”；若原图包含题目，请检查核对提示。
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="hint">下载的试卷仅包含题目和材料。</p>
                  {exam.annotations
                    .filter((annotation) =>
                      annotation.regions.some(
                        (region) => region.page === selectedPage,
                      ),
                    )
                    .map((annotation, index) => (
                      <article className="exam-question" key={index}>
                        <h3>
                          {annotationLabels[annotation.kind]}
                          {annotation.questionNumber &&
                            ` · 第 ${annotation.questionNumber} 题`}
                        </h3>
                        {blocks(annotation.blocks, `annotation-${index}`)}
                      </article>
                    ))}
                  {!exam.annotations.some((annotation) =>
                    annotation.regions.some(
                      (region) => region.page === selectedPage,
                    ),
                  ) && (
                    <p className="setup-note muted">
                      本页没有识别到作答或批注。
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
          <details className="verification-details">
            <summary>解析记录</summary>
            <p className="hint">处理模型：{task.model}</p>
            {exam.verification.corrections
              .filter((item) => item.changes.length)
              .map((item) => (
                <div key={item.page}>
                  <h3>第 {item.page} 页的修正</h3>
                  <ul>
                    {item.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </div>
              ))}
            <a href={`${fileURL("verification.json")}?download`}>
              下载核对记录
            </a>
          </details>
          <details className="verification-details">
            <summary>重新识别这份试卷</summary>
            <p className="hint">重新识别后，这里会展示新的结果。</p>
            <button
              className="button secondary"
              disabled={retrying}
              onClick={() => void retry()}
            >
              {retrying ? "正在提交…" : "重新识别"}
            </button>
          </details>
        </>
      )}
    </>
  );
}

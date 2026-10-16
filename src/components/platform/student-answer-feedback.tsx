"use client";

import Image from "next/image";
import { Fragment, useState } from "react";
import type { Paper, PlatformState } from "@/contracts/platform";
import { MarkdownText } from "@/components/markdown-text";
import { QuestionBody } from "./questions";
import { QuestionAnswers } from "./question-answers";
import { Empty, Panel } from "./primitives";
import { PaperSharedReading } from "./paper-reading";

type PaperItem = Paper["items"][number];
const participationLabels = { ABSENT: "缺考", EXEMPT: "免考", WITHDRAWN: "退出" };

/** Show the paper's actual allocation, rather than the source question's relative weights. */
function allocatedQuestion(item: PaperItem) {
  if (item.snapshot.type !== "MIXED") return item.snapshot;
  const weight = item.snapshot.content.parts.reduce((sum, part) => sum + part.score, 0);
  return {
    ...item.snapshot,
    content: {
      ...item.snapshot.content,
      parts: item.snapshot.content.parts.map((part) => ({
        ...part,
        score: weight ? Number(((item.score * part.score) / weight).toFixed(4)) : 0,
      })),
    },
  };
}

export function StudentAnswerFeedback({
  state,
  assessmentId,
  refresh,
}: {
  state: PlatformState;
  assessmentId: string;
  refresh?: () => Promise<void>;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const assessment = state.assessments.find(
    (entry) => entry.id === assessmentId && entry.published && entry.rosterStatus === "CONFIRMED",
  );
  if (state.actor.role !== "STUDENT" || !assessment) return null;
  const ownIds = new Set(
    state.classrooms.flatMap((classroom) =>
      classroom.students
        .filter((student) => student.userId === state.actor.id)
        .map((student) => student.id),
    ),
  );
  const participants = assessment.participants.filter((participant) =>
    ownIds.has(participant.studentId),
  );
  return (
    <Panel
      title="本次完整作答与反馈"
      description="查看所有题目的原作答与已发布评分，包括答对的题目；参考答案可按需展开。"
    >
      {refresh && (
        <div className="p-toolbar">
          <button
            type="button"
            className="button secondary"
            disabled={reading}
            onClick={async () => {
              if (reading) return;
              setReading(true);
              setError("");
              try {
                await refresh();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取反馈失败，请重试。");
              } finally {
                setReading(false);
              }
            }}
          >
            {reading ? "正在读取反馈…" : "重新读取本次反馈"}
          </button>
        </div>
      )}
      {error && (
        <p className="p-notice error" role="alert">
          {error}。当前显示上次读取的已发布反馈。
        </p>
      )}
      {!participants.length ? (
        <Empty>没有可查看的本人作答记录。</Empty>
      ) : (
        participants.map((participant) => (
          <div key={participant.id}>
            {participants.length > 1 && (
              <h3>
                {participant.classroomName} · {participant.name}
              </h3>
            )}
            {assessment.papers.map((config) => {
              const participation = participant.subjects.find(
                (entry) => entry.paperId === config.paperId,
              );
              if (!participation) return null;
              const subject = state.analytics.results
                .find(
                  (result) =>
                    result.assessmentId === assessment.id &&
                    result.studentId === participant.studentId,
                )
                ?.subjects.find((entry) => entry.paperId === config.paperId);
              const paper = state.papers.find((entry) => entry.id === config.paperId);
              const submission = state.submissions.find(
                (entry) =>
                  entry.assessmentId === assessment.id &&
                  entry.paperId === config.paperId &&
                  entry.studentId === participant.studentId,
              );
              return (
                <section
                  className="p-panel-content"
                  key={config.paperId}
                  aria-label={`${config.subject}作答与反馈`}
                >
                  <h3>
                    {config.subject} · {paper?.name ?? "科目作答"}
                  </h3>
                  {participation.status !== "REQUIRED" ? (
                    <p className="p-notice" role="status">
                      本次科目登记为{participationLabels[participation.status]}
                      ，不计零分，不计入全科总分。
                      {participation.reason && `原因：${participation.reason}`}
                    </p>
                  ) : !paper ? (
                    <Empty>本次试卷内容暂不可用，请联系老师核对。</Empty>
                  ) : (
                    <>
                      <p>
                        原始分：{subject?.rawScore ?? "尚无已发布评分"} /{" "}
                        {subject?.maxScore ??
                          paper.items.reduce((sum, item) => sum + item.score, 0)}
                        {subject?.score !== null &&
                        subject?.score !== undefined &&
                        subject.score !== subject.rawScore
                          ? ` · 赋分：${subject.score}`
                          : ""}
                      </p>
                      <PaperSharedReading paper={paper} context={`${config.subject}卷首`} />
                      {submission?.sourceFiles.length ? (
                        <details className="p-answers">
                          <summary>查看完整答卷原图（{submission.sourceFiles.length} 页）</summary>
                          {submission.sourceFiles.map((url, index) => (
                            <p key={`${url}/${index}`}>
                              <a href={url} target="_blank" rel="noreferrer">
                                打开第 {index + 1} 页答卷原图
                              </a>
                            </p>
                          ))}
                        </details>
                      ) : null}
                      {!paper.items.length && <Empty>本次试卷没有可查看的题目。</Empty>}
                      {paper.items.map((item, index) => {
                        const grade = subject?.grades.find((entry) => entry.itemId === item.id);
                        const answer = submission?.answers.find(
                          (entry) => entry.itemId === item.id,
                        );
                        const question = allocatedQuestion(item);
                        return (
                          <Fragment key={item.id}>
                            <PaperSharedReading
                              paper={paper}
                              beforeItemId={item.id}
                              context={`${config.subject}第${index + 1}题前`}
                            />
                            <article
                              className="p-question"
                              key={item.id}
                              aria-label={`第 ${index + 1} 题作答与反馈`}
                            >
                              <div className="p-question-head">
                                <h4>第 {index + 1} 题</h4>
                                <strong>
                                  {grade?.score ?? "尚无已发布评分"} / {item.score} 分
                                </strong>
                              </div>
                              <QuestionBody question={question} />
                              <div className="p-answers">
                                <h4>我的作答</h4>
                                {answer?.text && <MarkdownText text={answer.text} />}
                                {answer?.images.map((url, imageIndex) => (
                                  <a
                                    key={`${url}/${imageIndex}`}
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Image
                                      unoptimized
                                      width={1000}
                                      height={1000}
                                      className="p-scan-image"
                                      src={url}
                                      alt={`第 ${index + 1} 题本人作答图 ${imageIndex + 1}`}
                                    />
                                  </a>
                                ))}
                                {!answer?.text && !answer?.images.length && (
                                  <p className="p-muted">
                                    未保留本题作答内容，可查看完整答卷原图或请老师核对。
                                  </p>
                                )}
                                <h4>老师反馈</h4>
                                <MarkdownText text={grade?.feedback || "本题暂无文字反馈"} />
                                {question.type === "MIXED" &&
                                  question.content.parts.map((part, partIndex) => {
                                    const actual = grade?.partScores?.find(
                                      (entry) => entry.partId === part.id,
                                    );
                                    return (
                                      <section
                                        className="p-part"
                                        key={part.id}
                                        aria-label={`第 ${index + 1} 题第 ${partIndex + 1} 小问评分`}
                                      >
                                        <h4>
                                          第 {partIndex + 1} 小问 ·{" "}
                                          {actual?.score ?? "尚无小问评分"} / {part.score} 分
                                        </h4>
                                        <MarkdownText
                                          text={actual?.feedback || "本小问暂无文字反馈"}
                                        />
                                      </section>
                                    );
                                  })}
                              </div>
                              <details className="p-answers">
                                <summary>查看第 {index + 1} 题参考答案与解析</summary>
                                <QuestionAnswers content={question.content} />
                              </details>
                            </article>
                          </Fragment>
                        );
                      })}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        ))
      )}
    </Panel>
  );
}

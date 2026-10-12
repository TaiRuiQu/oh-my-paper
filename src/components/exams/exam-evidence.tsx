"use client";
/* Evidence crops retain the original scan dimensions. */
/* eslint-disable @next/next/no-img-element */
import type { DigitalExam } from "@/contracts/exams";
import { regionsEqual } from "@/lib/figure-assets";

type Question = DigitalExam["questions"][number];

export function ExamEvidence({
  exam,
  currentPage,
  selectedPage,
  tab,
  questions,
  activeQuestion,
  visibleQuestions,
  materials,
  fileURL,
  onSelectQuestion,
}: {
  exam: DigitalExam;
  currentPage: DigitalExam["pages"][number] | undefined;
  selectedPage: number;
  tab: "questions" | "annotations";
  questions: Question[];
  activeQuestion: Question | undefined;
  visibleQuestions: Question[];
  materials: DigitalExam["materials"];
  fileURL: (key: string) => string;
  onSelectQuestion: (id: string) => void;
}) {
  return (
    <>
      <section className="source-panel" aria-labelledby="source-heading">
        <div className="section-heading">
          <h2 id="source-heading">原图 · 第 {selectedPage} 页</h2>
          {currentPage && (
            <a href={fileURL(currentPage.key)} target="_blank" rel="noreferrer">
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
                      onClick={() => onSelectQuestion(q.id)}
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
                      ].some((b) => b.type === "figure" && regionsEqual(b.region, a.region)),
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
                <a href={fileURL(crop.key)} target="_blank" rel="noreferrer">
                  查看切片
                </a>
              </figcaption>
            </figure>
          ))
        ) : (
          <p className="setup-note muted">
            {activeQuestion ? "当前存稿未保存切片，可重新识别生成。" : "请选择含题目的页面。"}
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
                ].some((b) => b.type === "figure" && regionsEqual(b.region, a.region)),
              )
              .map((asset) => (
                <figure className="exam-figure" key={asset.id}>
                  <img src={fileURL(asset.evidenceKey)} alt={asset.caption} loading="lazy" />
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
    </>
  );
}

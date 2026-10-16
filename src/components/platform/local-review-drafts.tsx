"use client";
import type { LocalReviewDraft } from "./reviews";
import { Panel } from "./primitives";

/** Only local field deltas, never a cached question, student answer, or server mark. */
export function LocalReviewDrafts({
  drafts,
  onDiscard,
}: {
  drafts: LocalReviewDraft[];
  onDiscard: () => void;
}) {
  if (!drafts.length) return null;
  return (
    <section aria-label="曾脱离授权答卷的本人本地输入">
      <Panel
        title="本人未提交的本地评分输入"
        description="这里只保留本页中本人修改的字段，不包含题干、同学作答或未修改的服务端评分。重新授权也不会自动填入评分表单、采用新基线或转移到新提交；请复制核对或明确放弃。"
      >
        {drafts.map((draft, index) => (
          <section
            key={index}
            aria-label={`保留输入第 ${index + 1} 条 · 第 ${draft.questionNumber} 题本人本地输入`}
          >
            <h3>
              第 {draft.questionNumber} 题 ·{" "}
              {{ FIRST: "第一评", SECOND: "第二评", ARBITRATION: "仲裁" }[draft.round]}
            </h3>
            {draft.score !== undefined && <p>本人修改的得分：{draft.score || "未填写"}</p>}
            {draft.feedback !== undefined && (
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                本人修改的反馈：{draft.feedback || "已清空"}
              </p>
            )}
            {draft.parts.map((part) => (
              <div key={part.number}>
                <strong>第 {part.number} 小问</strong>
                {part.score !== undefined && <p>本人修改的得分：{part.score}</p>}
                {part.feedback !== undefined && (
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    本人修改的反馈：{part.feedback || "已清空"}
                  </p>
                )}
              </div>
            ))}
          </section>
        ))}
        <button type="button" className="button secondary" onClick={onDiscard}>
          明确放弃本人本地评分输入
        </button>
      </Panel>
    </section>
  );
}

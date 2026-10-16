"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/http-client";
import { PracticePanel } from "./primitives";
import { PracticeProvider, usePractice } from "./provider";
import styles from "./practice.module.css";
import type { PracticeEvidence } from "@/contracts/practice";
import { PracticeFrame as Frame } from "./frame";
import { eligibilityLabels, evaluationLabels, judgmentLabels } from "./feedback";
export function PracticeEvidenceWorkspace() {
  return (
    <Frame
      title="练习证据与近期表现"
      description="按真实提交与评价来源展示学习证据；不推断掌握百分比，不改写正式成绩。"
      back={{ href: "/learning/practice", label: "返回自主练习" }}
    >
      <PracticeProvider path="/api/platform/practice/evidence">
        <EvidenceResource />
      </PracticeProvider>
    </Frame>
  );
}
function EvidenceResource() {
  const { data, generation, pending, refresh } = usePractice<PracticeEvidence>();
  return <EvidenceRows key={generation} initial={data} refreshing={pending} refresh={refresh} />;
}
function EvidenceRows({
  initial,
  refreshing,
  refresh,
}: {
  initial: PracticeEvidence;
  refreshing: boolean;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <PracticePanel
      title="本人的练习证据"
      description="本人自评、AI候选、教师核验各自计数；已看参考或复现的正确结果不能冒充未提供参考的新题证据。"
      actions={
        <button
          className="button secondary"
          type="button"
          disabled={loading || refreshing}
          onClick={async () => {
            try {
              await refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败，已显示证据保留。");
            }
          }}
        >
          重新读取练习证据
        </button>
      }
    >
      <p>
        提交轮次 {data.summary.submittedAttempts} · 不同题目 {data.summary.distinctQuestions} ·
        提交前未提供参考的题目 {data.summary.unexposedQuestions} · 复现或已参考题{" "}
        {data.summary.repeatedOrAssistedQuestions}
      </p>
      <p>
        本人自评 {data.summary.selfAssessed} · AI候选 {data.summary.aiCandidates} · 教师核验{" "}
        {data.summary.teacherConfirmed}
      </p>
      <p className={styles.help}>
        按各轮提交时记录分组，同题可出现在多组，数量不能相加。参考情况保留提交时快照。
        以上为证据数量，不是掌握结论。看不清、待核验、跳过以及未确认候选分别保留，不伪装正确或零分。
      </p>
      <div className={styles.tableRegion} role="region" aria-label="本人练习证据明细" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>知识点 / 学科</th>
              <th>核对结果</th>
              <th>来源</th>
              <th>参考情况（提交时）</th>
              <th>记录</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((entry, index) => (
              <tr key={`${entry.evaluationId}/${entry.itemId}/${entry.partId ?? "whole"}/${index}`}>
                <td>
                  {entry.knowledgeTags.join("、") || "未标注知识点"}
                  <small>
                    {entry.subject}
                    {entry.partId ? " · 小问证据" : ""}
                  </small>
                </td>
                <td>{judgmentLabels[entry.judgment]}</td>
                <td>
                  {evaluationLabels[entry.source]}
                  <small>v{entry.evaluationVersion}</small>
                </td>
                <td>{eligibilityLabels[entry.eligibility]}</td>
                <td>
                  <Link
                    href={`/learning/practice/${entry.sessionId}?${new URLSearchParams({ attemptId: entry.attemptId, evaluationId: entry.evaluationId })}`}
                  >
                    查看来源提交与反馈
                  </Link>
                  <small>
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(entry.recordedAt))}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.items.length && (
        <p className="p-empty">尚无练习评价证据；先提交一次练习，再完成自评或请求核验。</p>
      )}
      {error && (
        <p role="alert" className="p-notice error">
          {error}，可重试。
        </p>
      )}
      {data.nextBeforeId && (
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setLoading(true);
            try {
              const next = await apiRequest<PracticeEvidence>(
                `/api/platform/practice/evidence?${new URLSearchParams({ beforeId: data.nextBeforeId! })}`,
              );
              setData((prev) => ({ ...next, items: [...prev.items, ...next.items] }));
              setError("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败");
            } finally {
              lock.current = false;
              setLoading(false);
            }
          }}
        >
          读取更早练习证据
        </button>
      )}
    </PracticePanel>
  );
}

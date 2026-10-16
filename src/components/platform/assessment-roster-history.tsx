"use client";
import { useRef, useState } from "react";
import type { RosterHistory } from "@/contracts/assessment-roster-history";
import type { ParticipationStatus } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { Button } from "@/components/ui/button";
import { Empty, Panel } from "./primitives";

const labels: Record<ParticipationStatus, string> = {
  REQUIRED: "应考",
  ABSENT: "缺考",
  EXEMPT: "免考",
  WITHDRAWN: "退出",
};
export function AssessmentRosterHistory({ assessmentId }: { assessmentId: string }) {
  const [history, setHistory] = useState<RosterHistory>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const loading = useRef(false);
  async function read(more = false) {
    if (loading.current) return;
    loading.current = true;
    setPending(true);
    setError("");
    try {
      const query = new URLSearchParams({ assessmentId });
      if (more && history?.nextBeforeRevision)
        query.set("beforeRevision", String(history.nextBeforeRevision));
      const result = await apiRequest<RosterHistory>(`/api/platform/roster-history?${query}`);
      if (more && history && result.currentRevision !== history.currentRevision) {
        setError("名单已有新变更，请重新读取历史后再继续查看。");
        return;
      }
      setHistory(
        more && history ? { ...result, events: [...history.events, ...result.events] } : result,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取名单历史失败，请重试。");
    } finally {
      loading.current = false;
      setPending(false);
    }
  }
  return (
    <Panel
      title="名单变更历史"
      description="只读记录：按当前班级与学科权限显示，名单调整不会删除原答卷或评分。"
      actions={
        <Button variant="outline" disabled={pending} onClick={() => void read()}>
          {pending ? "正在读取历史…" : history ? "重新读取历史" : "读取变更历史"}
        </Button>
      }
    >
      <div className="p-panel-content" aria-busy={pending}>
        {error && (
          <p className="p-notice error" role="alert">
            {error}。可使用上方按钮重试。
          </p>
        )}
        {history?.scopeRestricted && (
          <p className="p-notice">
            仅展示当前授权班级和学科的逐项变更；其他范围及整体调整原因不展示。
          </p>
        )}
        {!history && !error && (
          <p className="p-muted">读取后可核对变更版本、操作者、时间、参与学生、科目状态与原因。</p>
        )}
        {history && !history.events.length && (
          <Empty>
            当前查询范围没有可显示的变更记录。
            {history.nextBeforeRevision ? "可继续读取更早记录。" : ""}
          </Empty>
        )}
        {history?.events.map((event) => (
          <section
            key={event.id}
            className="p-part"
            aria-label={`名单版本 ${event.revision} 的变更`}
          >
            <h3>名单版本 {event.revision}</h3>
            <p className="p-muted">
              操作账号：{event.actorName} ·{" "}
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString("zh-CN")}
              </time>
            </p>
            <p>本次原因：{event.reason}</p>
            {event.confirmedReconstruction && (
              <p className="p-notice">已明确核对并确认重建名单。</p>
            )}
            {event.reconstructedCandidate && (
              <p className="p-notice">
                系统按迁移时班级名单与已有答卷重建候选名单，须人工核对；这不是原始实际参试名单的确认记录。
              </p>
            )}
            {!event.entries.length &&
              !event.confirmedReconstruction &&
              !event.reconstructedCandidate && (
                <p className="p-muted">本次调整了参与范围，没有新增逐科状态变化。</p>
              )}
            {event.entries.length > 0 && (
              <div
                className="p-table"
                role="region"
                aria-label={`版本 ${event.revision} 逐项名单变更`}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>学生 / 本次班级</th>
                      <th>科目</th>
                      <th>状态变化</th>
                      <th>逐项原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.entries.map((entry, index) => (
                      <tr key={`${entry.studentId}/${entry.paperId}/${index}`}>
                        <td>
                          <strong>{entry.name}</strong>
                          <small>
                            {entry.studentNumber} · {entry.classroomName}
                          </small>
                        </td>
                        <td>{entry.subject}</td>
                        <td>
                          {entry.kind === "ADDED" ? "加入名单" : labels[entry.beforeStatus!]} →{" "}
                          {labels[entry.status]}
                        </td>
                        <td>{entry.reason || "未填写逐项原因"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
        {history?.nextBeforeRevision && (
          <Button variant="outline" disabled={pending} onClick={() => void read(true)}>
            读取更早记录
          </Button>
        )}
      </div>
    </Panel>
  );
}

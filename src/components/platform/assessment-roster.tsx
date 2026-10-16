"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Assessment, ParticipationStatus } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { useDomain } from "./domain-provider";
import { Field, Panel } from "./primitives";
import { useUnsavedChanges } from "./use-unsaved-changes";

const labels: Record<ParticipationStatus, string> = {
  REQUIRED: "应考",
  ABSENT: "缺考",
  EXEMPT: "免考",
  WITHDRAWN: "退出",
};
type Change = {
  participantId: string;
  paperId: string;
  status: ParticipationStatus;
  reason: string;
};

export function AssessmentRoster({
  assessment: a,
  root,
}: {
  assessment: Assessment;
  root: string;
}) {
  const { state, mutate, pending, refresh } = useDomain();
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(a.rosterRevision);
  const [changes, setChanges] = useState<Change[]>([]);
  const [additions, setAdditions] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [savedRevision, setSavedRevision] = useState(0);
  const saving = useRef(false);
  const [savingState, setSavingState] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canManage = a.canManage === true;
  const conflict = editing && a.rosterRevision !== revision;
  const awaitingRefresh = savedRevision > a.rosterRevision;
  const dirty = editing && (!!changes.length || !!additions.length || !!reason || confirmed);
  const { confirmDiscard, markSaved } = useUnsavedChanges(
    dirty,
    "有未保存的名单调整，离开后会丢失。确定离开？",
  );
  const candidates = state.classrooms
    .filter((c) => a.classroomIds.includes(c.id))
    .flatMap((c) =>
      c.students
        .filter((s) => !a.participants.some((p) => p.studentId === s.id))
        .map((s) => ({ ...s, classroomName: c.name })),
    );
  const busy = pending || savingState || refreshing;
  const inputsDisabled = !editing || busy || preview || a.published || !canManage;
  function start() {
    setRevision(a.rosterRevision);
    setChanges([]);
    setAdditions([]);
    setReason("");
    setConfirmed(false);
    setPreview(false);
    setError("");
    setEditing(true);
  }
  async function reloadRoster() {
    if (saving.current || pending) return;
    if (dirty && !window.confirm("重新读取名单会放弃本次未保存的调整。确定重新读取？")) return;
    saving.current = true;
    setRefreshing(true);
    try {
      await refresh();
      markSaved();
      setEditing(false);
      setChanges([]);
      setAdditions([]);
      setReason("");
      setConfirmed(false);
      setPreview(false);
      setSavedRevision(0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取最新名单失败，请重试。");
    } finally {
      saving.current = false;
      setRefreshing(false);
    }
  }
  async function submit() {
    if (saving.current || pending || conflict || a.published || !canManage) return;
    if (!reason.trim()) {
      setError("请填写本次调整或确认的原因。");
      return;
    }
    if (changes.some((c) => !c.reason.trim())) {
      setError("请填写每项科目状态调整的原因。");
      return;
    }
    if (a.rosterStatus === "NEEDS_REVIEW" && !confirmed) {
      setError("请核对后确认重建名单。");
      return;
    }
    if (!changes.length && !additions.length && a.rosterStatus !== "NEEDS_REVIEW") {
      setError("尚未选择需要调整的内容。");
      return;
    }
    if (!preview) {
      setError("");
      setPreview(true);
      return;
    }
    saving.current = true;
    setSavingState(true);
    try {
      const result = await mutate({
        type: "assessment.roster.update",
        id: a.id,
        expectedRevision: revision,
        reason: reason.trim(),
        addStudentIds: additions,
        changes: changes.map((c) => ({ ...c, reason: c.reason.trim() })),
        confirmReconstruction: confirmed,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      markSaved();
      setSavedRevision(revision + 1);
      setEditing(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "名单保存失败，请重试。");
    } finally {
      saving.current = false;
      setSavingState(false);
    }
  }
  return (
    <Panel
      title={`${a.participants.length} 位名单成员`}
      description={`名单版本 ${a.rosterRevision} · ${a.rosterStatus === "CONFIRMED" ? "已确认" : "待核对重建"}`}
      actions={
        !editing &&
        canManage &&
        !a.published && (
          <Button variant="outline" disabled={busy || awaitingRefresh} onClick={start}>
            调整参与名单
          </Button>
        )
      }
    >
      <div className="p-panel-content">
        <p className="p-muted">
          名单保存本次安排的学生、班级和逐科参与状态。班级名册后续变化不会自动改动本次名单。缺考与免考单独记录，不计为零分；退出保留原有记录。
        </p>
        {a.published && (
          <p className="p-notice">
            {canManage ? (
              <>
                成绩已发布。需要调整名单时，请先
                <Link href={`${root}/${a.id}/publish`}>撤回成绩发布</Link>。
              </>
            ) : (
              "成绩已发布。需要调整名单时，请联系安排创建者或管理员。"
            )}
          </p>
        )}
        {!canManage && (
          <p className="p-notice">当前可查看参与名单；调整请联系安排创建者或管理员。</p>
        )}
        {a.rosterStatus === "NEEDS_REVIEW" && (
          <p className="p-notice" role="status">
            这份历史安排的候选名单由现存记录重建，不能代表原始参试名单。请逐人逐科核对并确认后，再扫描、批改或发布。
          </p>
        )}
        {awaitingRefresh && (
          <p className="p-notice" role="status">
            名单已保存，正在等待列表更新。请使用页面保存提示中的“重新加载列表”，无需再次提交。
          </p>
        )}
        {conflict && (
          <p className="p-notice error" role="alert">
            名单已更新到版本 {a.rosterRevision}
            。你的调整仍保留，不能覆盖新版本；请重新读取名单并核对。
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          aria-label="参与名单调整"
          aria-busy={busy}
        >
          <div style={{ minWidth: 0 }}>
            <div className="p-table" role="region" aria-label="参与学生与逐科状态" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>姓名 / 学号</th>
                    <th>本次班级</th>
                    {a.papers.map((paper) => (
                      <th key={paper.paperId}>{paper.subject}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.participants.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <small>{p.studentNumber}</small>
                      </td>
                      <td>{p.classroomName}</td>
                      {a.papers.map((paper) => {
                        const original = p.subjects.find((s) => s.paperId === paper.paperId);
                        const change = changes.find(
                          (c) => c.participantId === p.id && c.paperId === paper.paperId,
                        );
                        const current = change ?? original;
                        return (
                          <td key={paper.paperId}>
                            {editing && original ? (
                              <>
                                <select
                                  disabled={inputsDisabled}
                                  aria-label={`${p.name} ${paper.subject}参与状态`}
                                  value={current?.status}
                                  onChange={(e) => {
                                    const status = e.target.value as ParticipationStatus;
                                    setChanges((items) => [
                                      ...items.filter(
                                        (c) =>
                                          c.participantId !== p.id || c.paperId !== paper.paperId,
                                      ),
                                      ...(status === original.status
                                        ? []
                                        : [
                                            {
                                              participantId: p.id,
                                              paperId: paper.paperId,
                                              status,
                                              reason: change?.reason ?? "",
                                            },
                                          ]),
                                    ]);
                                  }}
                                >
                                  {Object.entries(labels).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                                {change && (
                                  <input
                                    disabled={inputsDisabled}
                                    required
                                    maxLength={500}
                                    aria-label={`${p.name} ${paper.subject}调整原因`}
                                    placeholder="本项调整原因"
                                    value={change.reason}
                                    onChange={(e) =>
                                      setChanges((items) =>
                                        items.map((c) =>
                                          c.participantId === p.id && c.paperId === paper.paperId
                                            ? { ...c, reason: e.target.value }
                                            : c,
                                        ),
                                      )
                                    }
                                  />
                                )}
                              </>
                            ) : (
                              <>
                                {current ? labels[current.status] : "缺少科目状态"}
                                {current?.reason && <small>{current.reason}</small>}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!a.participants.length && <p className="p-empty">当前名单为空，请补充参与学生。</p>}
            {editing && (
              <>
                <h3>补充参与学生</h3>
                <p className="p-muted">
                  只列出参与班级中尚未加入本次名单的学生。加入后本次所有科目默认为应考。
                </p>
                <div className="p-actions">
                  {candidates.map((s) => (
                    <label className="p-check" key={s.id}>
                      <input
                        disabled={inputsDisabled}
                        type="checkbox"
                        checked={additions.includes(s.id)}
                        onChange={(e) =>
                          setAdditions((ids) =>
                            e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                          )
                        }
                      />
                      {s.name} · {s.studentNumber} · {s.classroomName}
                    </label>
                  ))}
                </div>
                {!candidates.length && <p className="p-muted">没有可补充的学生。</p>}
                <Field label="本次调整或确认原因">
                  <textarea
                    disabled={inputsDisabled}
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                {a.rosterStatus === "NEEDS_REVIEW" && (
                  <label className="p-check">
                    <input
                      disabled={inputsDisabled}
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    我已核对这份重建名单及每科参与状态，确认可用于本次安排。
                  </label>
                )}
              </>
            )}
          </div>
          {editing && preview && (
            <div className="p-answers" role="status">
              <h3>确认名单调整</h3>
              <p>
                基于版本 {revision}，补充 {additions.length} 位学生，调整 {changes.length}{" "}
                项科目状态。原因：{reason}
              </p>
              <ul>
                {additions.map((id) => (
                  <li key={id}>加入：{candidates.find((s) => s.id === id)?.name}，全部科目应考</li>
                ))}
                {changes.map((c) => (
                  <li key={`${c.participantId}-${c.paperId}`}>
                    {a.participants.find((p) => p.id === c.participantId)?.name} ·{" "}
                    {a.papers.find((p) => p.paperId === c.paperId)?.subject} → {labels[c.status]}：
                    {c.reason}
                  </li>
                ))}
              </ul>
              {confirmed && <p>确认重建名单，开放后续扫描、批改和发布检查。</p>}
              <p>
                原有答卷和评分保留。缺考、免考、退出的科目将停止接收扫描和批改，并按参与状态重算报告。
              </p>
            </div>
          )}
          {error && (
            <p className="p-notice error" role="alert">
              {error}
            </p>
          )}
          {(error || conflict || awaitingRefresh) && (
            <div className="p-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void reloadRoster()}
              >
                {refreshing ? "正在读取名单…" : "重新读取名单"}
              </Button>
              <p className="p-muted">读取成功后重新核对最新名单，不会自动重放本次修改。</p>
            </div>
          )}
          {editing && (
            <div className="p-actions">
              <Button type="submit" disabled={busy || conflict || a.published || !canManage}>
                {busy ? "正在保存…" : preview ? "确认并保存名单" : "预览调整影响"}
              </Button>
              {preview && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPreview(false)}
                >
                  返回修改
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (confirmDiscard()) setEditing(false);
                }}
              >
                取消调整
              </Button>
            </div>
          )}
        </form>
      </div>
    </Panel>
  );
}

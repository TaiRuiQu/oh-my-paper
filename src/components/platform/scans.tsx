"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DOCUMENT_UPLOAD_ACCEPT, type ScanUploadPage } from "@/contracts/uploads";
import { prepareScanPages, appendScanPages } from "@/lib/document-upload";
import { useRef, useState } from "react";
import type { Box, PlatformState } from "@/contracts/platform";
import { Empty, Field, Panel } from "./primitives";
import { apiRequest } from "@/lib/http-client";
import { useOptionalDomain } from "./domain-provider";
import { WorkbookCrop } from "./workbook-crop";
import { submissionNeedsScanReview } from "@/lib/scan-recognition";
import {
  assessmentReviewBlockReason,
  findAssessmentParticipant,
  rosterStudentsForPaper,
} from "@/lib/assessment-roster";
type ScanBox = Box & { itemId: string };
type ScannerDevice = {
  id: string;
  name: string;
  backend?: "sane" | "escl";
  unavailable?: string;
};
export function Scans({
  state,
  refresh,
  notify,
  fixedKind,
  section,
  initialAssessmentId,
}: {
  fixedKind?: "CARD" | "WORKBOOK";
  section?: "upload" | "device" | "history";
  initialAssessmentId?: string;
  state: PlatformState;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [assessmentId, setAssessmentId] = useState(
      initialAssessmentId ?? state.assessments[0]?.id ?? "",
    ),
    [paperId, setPaperId] = useState(""),
    [kind, setKind] = useState(fixedKind ?? "CARD"),
    [localFiles, setLocalFiles] = useState<ScanUploadPage[]>([]),
    [busy, setBusy] = useState(false),
    [templateId, setTemplateId] = useState(""),
    [studentId, setStudentId] = useState(""),
    [boxes, setBoxes] = useState<ScanBox[]>([]),
    [coordinatesOpen, setCoordinatesOpen] = useState(false),
    [issues, setIssues] = useState<{ file: string; error: string; sourceUrl?: string }[]>([]);
  const uploadInFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const [imported, setImported] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const domain = useOptionalDomain();
  const files = domain?.scanFiles ?? localFiles;
  const setFiles = domain?.setScanFiles ?? setLocalFiles;
  const assessment = state.assessments.find((a) => a.id === assessmentId),
    paper = state.papers.find((p) => p.id === paperId),
    students = assessment ? rosterStudentsForPaper(assessment, paperId) : [];
  const rosterUnconfirmed = assessment && assessment.rosterStatus !== "CONFIRMED";
  const canManagePublication =
    state.actor.role === "ADMIN" || assessment?.ownerId === state.actor.id;
  const [bridge, setBridge] = useState("http://127.0.0.1:17863"),
    [token, setToken] = useState(""),
    [devices, setDevices] = useState<ScannerDevice[]>([]),
    [device, setDevice] = useState(""),
    [source, setSource] = useState("Platen"),
    [resolution, setResolution] = useState(300),
    [duplex, setDuplex] = useState(false),
    [maxPages, setMaxPages] = useState(100);
  const selectedDevice = devices.find((d) => d.id === device),
    batch =
      source === "Feeder" &&
      (selectedDevice?.backend === "escl" || selectedDevice?.id.startsWith("escl:"));
  const selectedStudent = students.find((student) => student.id === studentId);
  // A refreshed roster must not retain an invisible override or restore it later.
  if (studentId && !selectedStudent) setStudentId("");
  async function scanner(action: "devices" | "scan") {
    setBusy(true);
    try {
      if (action === "scan") {
        if (!selectedDevice || selectedDevice.unavailable)
          throw new Error("请选择一台可用的扫描仪。");
        if (files.length >= 100) throw new Error("待上传列表已达 100 页，请先上传或移除图像。");
        if (batch && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100))
          throw new Error("单次采集页数上限须为 1 至 100。");
      }
      const res = await fetch(
        `${bridge.replace(/\/$/, "")}/${action === "scan" && batch ? "scan-batch" : action}`,
        {
          method: action === "devices" ? "GET" : "POST",
          headers: { "X-Scanner-Token": token, "Content-Type": "application/json" },
          ...(action === "scan"
            ? {
                body: JSON.stringify({
                  deviceId: device,
                  resolution,
                  source,
                  duplex: batch && duplex,
                  ...(batch ? { maxPages: Math.min(maxPages, 100 - files.length) } : {}),
                }),
              }
            : {}),
        },
      );
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          typeof detail?.error === "string" ? detail.error : `扫描仪服务返回 HTTP ${res.status}`,
        );
      }
      if (action === "devices") {
        const body = (await res.json()) as { devices?: ScannerDevice[] } | ScannerDevice[];
        const list = Array.isArray(body) ? body : (body.devices ?? []);
        setDevices(list);
        setDevice(list.find((d) => !d.unavailable)?.id ?? "");
        const available = list.filter((d) => !d.unavailable).length;
        notify(
          available
            ? `发现 ${available} 台可用扫描仪`
            : "未发现可用扫描仪，请检查设备连接与桥接配置。",
          !available,
        );
      } else {
        let pages: Blob[];
        if (batch) {
          const body = (await res.json()) as { pages?: { mime: string; data: string }[] };
          if (
            !Array.isArray(body.pages) ||
            !body.pages.length ||
            body.pages.length > Math.min(maxPages, 100 - files.length)
          )
            throw new Error("扫描仪返回的页数无效，请检查进纸器后重试。");
          pages = body.pages.map((page) => {
            if (
              !["image/png", "image/jpeg"].includes(page.mime) ||
              typeof page.data !== "string" ||
              page.data.length > 45 * 1024 * 1024
            )
              throw new Error("扫描仪返回了不支持的图像。");
            return new Blob([Uint8Array.from(atob(page.data), (c) => c.charCodeAt(0))], {
              type: page.mime,
            });
          });
        } else pages = [await res.blob()];
        if (
          pages.some(
            (page) =>
              !["image/png", "image/jpeg"].includes(page.type) ||
              !page.size ||
              page.size > 32 * 1024 * 1024,
          )
        )
          throw new Error("扫描仪返回了空白、不支持或过大的图像。");
        const timestamp = Date.now();
        setFiles((previous) => [
          ...previous,
          ...pages.map(
            (page, index) =>
              new File(
                [page],
                `扫描-${timestamp}-${index + 1}.${page.type === "image/jpeg" ? "jpg" : "png"}`,
                { type: page.type },
              ),
          ),
        ]);
        const limitReached = batch && pages.length === Math.min(maxPages, 100 - files.length);
        notify(
          `扫描完成，${pages.length} 页图像已按顺序加入待上传列表。${limitReached ? "已达到本次页数上限，剩余纸张请继续采集。" : ""}`,
        );
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "扫描仪连接失败，请检查桥接服务与令牌。", true);
    } finally {
      setBusy(false);
    }
  }
  async function refreshRecords() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await refresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (
      uploadInFlight.current ||
      busy ||
      refreshFailed ||
      assessment?.published ||
      rosterUnconfirmed ||
      !files.length
    )
      return;
    uploadInFlight.current = true;
    setImported(null);
    setIssues([]);
    setBusy(true);
    try {
      if (studentId && !selectedStudent)
        throw new Error("指定学生已不在当前科目的应考名单中，请重新选择。");
      if (kind === "WORKBOOK" && !selectedStudent)
        throw new Error("请从当前科目的应考名单中选择对应学生。");
      if (kind === "WORKBOOK") {
        if (
          !paper ||
          new Set(boxes.map((b) => b.itemId)).size !== paper.items.length ||
          boxes.length > 500 ||
          paper.items.some((item) => boxes.filter((b) => b.itemId === item.id).length > 30) ||
          paper.items.some((item) => !boxes.some((b) => b.itemId === item.id))
        )
          throw new Error("请为每道题添加作答区域，每题最多 30 个，总计最多 500 个。");
        if (
          boxes.some(
            (b) =>
              !Number.isInteger(b.page) ||
              b.page < 1 ||
              b.page > files.length ||
              ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
              b.x < 0 ||
              b.y < 0 ||
              b.width <= 0 ||
              b.height <= 0 ||
              b.x + b.width > 1 ||
              b.y + b.height > 1,
          )
        )
          throw new Error("请检查答题区域的页码及坐标，区域须完整位于已上传页面内。");
      }
      const d = new FormData();
      d.set("assessmentId", assessmentId);
      d.set("rosterRevision", String(assessment?.rosterRevision));
      d.set("paperId", paperId);
      d.set("templateId", templateId);
      d.set("kind", kind);
      if (studentId) d.set("studentId", studentId);
      d.set("boxes", JSON.stringify(boxes));
      appendScanPages(d, files);
      const result = await apiRequest<{
        imported: number;
        issues: { file: string; error: string; sourceUrl?: string }[];
      }>("/api/platform/scan", { method: "POST", body: d });
      setIssues(result.issues);
      setImported(result.imported);
      setFiles([]);
      setBoxes([]);
      notify(
        `成功导入 ${result.imported} 份答卷${result.issues.length ? `，${result.issues.length} 项需要处理。` : "。请进入阅卷工作台。"}`,
        result.imported === 0,
      );
      await refreshRecords();
    } catch (e) {
      notify(e instanceof Error ? e.message : "上传失败", true);
    } finally {
      uploadInFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {(!section || section === "upload") && (
        <Panel
          title={fixedKind === "WORKBOOK" ? "练习册作答录入" : "扫描与作答录入"}
          description={
            fixedKind === "WORKBOOK"
              ? "选择学生与练习册，在原图上框选每题作答范围，保存后逐题批改。"
              : "答题卡按定位点矫正、卡号匹配并切分题目区域。"
          }
        >
          {assessment?.published && (
            <div className="p-panel-content" role="status">
              <p>
                该{assessment.kind === "HOMEWORK" ? "作业" : "考试"}
                成绩已发布，无法再录入作答。
                {canManagePublication
                  ? "请先撤回成绩，再继续上传。"
                  : "请联系安排创建者或管理员撤回成绩后，再继续上传。"}
              </p>
              {canManagePublication && (
                <Link
                  className="button secondary"
                  href={`${assessment.kind === "HOMEWORK" ? "/homework/assignments" : "/exams"}/${assessment.id}/publish`}
                >
                  管理成绩发布
                </Link>
              )}
            </div>
          )}
          <form className="p-form" onSubmit={upload}>
            {rosterUnconfirmed && (
              <p className="p-notice" role="status">
                请先在本次安排的参试名单中核对并确认学生，再录入作答。
              </p>
            )}
            <div className="p-form-grid">
              <Field label={fixedKind === "WORKBOOK" ? "作业安排" : "考试"}>
                <select
                  required
                  disabled={busy}
                  value={assessmentId}
                  onChange={(e) => {
                    setAssessmentId(e.target.value);
                    setPaperId("");
                    setStudentId("");
                    setTemplateId("");
                    setBoxes([]);
                  }}
                >
                  <option value="">{fixedKind === "WORKBOOK" ? "选择作业安排" : "选择考试"}</option>
                  {state.assessments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={fixedKind === "WORKBOOK" ? "练习册" : "科目试卷"}>
                <select
                  required
                  disabled={busy}
                  value={paperId}
                  onChange={(e) => {
                    setPaperId(e.target.value);
                    setStudentId("");
                    setTemplateId("");
                    setBoxes([]);
                    setCoordinatesOpen(false);
                  }}
                >
                  <option value="">选择试卷</option>
                  {assessment?.papers.map((p) => (
                    <option key={p.paperId} value={p.paperId}>
                      {state.papers.find((t) => t.id === p.paperId)?.name} · {p.subject}
                    </option>
                  ))}
                </select>
              </Field>
              {!fixedKind && (
                <Field label="扫描模式">
                  <select
                    disabled={busy}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as "CARD" | "WORKBOOK")}
                  >
                    <option value="CARD">规范答题卡（自动卡号识别）</option>
                    <option value="WORKBOOK">练习册 / 非规范作业</option>
                  </select>
                </Field>
              )}
              {kind === "CARD" && (
                <Field label="答题卡模板">
                  <select
                    required
                    disabled={busy}
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    <option value="">选择同版式模板</option>
                    {state.templates
                      .filter((t) => t.paperId === paperId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label={kind === "CARD" ? "指定学生（可覆盖卡号识别）" : "对应学生"}>
                <select
                  required={kind === "WORKBOOK"}
                  disabled={busy}
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                >
                  <option value="">{kind === "CARD" ? "通过卡号自动识别" : "请选择学生"}</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.studentNumber}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="批量选择扫描图片或 PDF"
              hint={
                fixedKind === "WORKBOOK"
                  ? "支持 PNG、JPG、WebP、PDF。PDF 按页码展开，按顺序选择该学生的作业扫描件。"
                  : "支持 PNG、JPG、WebP、PDF。PDF 按页码展开，再按模板页数合并每位学生的答题卡。"
              }
            >
              <input
                type="file"
                accept={DOCUMENT_UPLOAD_ACCEPT}
                multiple
                disabled={busy || !!assessment?.published || !!rosterUnconfirmed}
                onChange={async (e) => {
                  const selected = Array.from(e.target.files ?? []);
                  e.currentTarget.value = "";
                  if (!selected.length || assessment?.published || rosterUnconfirmed || busy)
                    return;
                  setBusy(true);
                  try {
                    const pages = await prepareScanPages(selected);
                    const existing = files.length;
                    let mode: "load" | "append" | "replace" = "load";
                    if (existing) {
                      mode = window.confirm(
                        `待上传列表已有 ${existing} 页扫描材料。点「确定」将清空列表，仅保留新选的 ${pages.length} 页（练习册已框选的作答区域会一并清除）；点「取消」则把新选的 ${pages.length} 页追加到列表末尾。`,
                      )
                        ? "replace"
                        : "append";
                      if (mode === "append" && existing + pages.length > 100)
                        throw new Error(
                          `追加后待上传列表将达 ${existing + pages.length} 页，超出 100 页上限，请先上传或移除部分图像。`,
                        );
                    }
                    setFiles((previous) => (mode === "append" ? [...previous, ...pages] : pages));
                    if (mode !== "append") setBoxes([]);
                    setIssues([]);
                    notify(
                      mode === "replace"
                        ? `已替换待上传列表，现有 ${pages.length} 页扫描材料。`
                        : mode === "append"
                          ? `已追加 ${pages.length} 页扫描材料，待上传列表现有 ${existing + pages.length} 页。`
                          : `已载入 ${pages.length} 页扫描材料。`,
                    );
                  } catch (error) {
                    notify(error instanceof Error ? error.message : "扫描材料读取失败", true);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Field>
            {files.length > 0 && (
              <div>
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="p-list-row">
                    <span>
                      {f.name}{" "}
                      <small className="p-muted">{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() => {
                        setFiles(files.filter((_, n) => n !== i));
                        setBoxes(
                          boxes
                            .filter((box) => box.page !== i + 1)
                            .map((box) =>
                              box.page > i + 1 ? { ...box, page: box.page - 1 } : box,
                            ),
                        );
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
            {kind === "WORKBOOK" && paper && !assessment?.published && !rosterUnconfirmed && (
              <>
                <h3>人工切题区域</h3>
                <WorkbookCrop
                  key={paper.id}
                  files={files}
                  paper={paper}
                  boxes={boxes}
                  onChange={setBoxes}
                  onAdd={() => setCoordinatesOpen(true)}
                  disabled={busy}
                />
                <p className="p-muted">
                  页面比例坐标 0–1，页码从 1
                  开始。每题可有多个区域，按下方顺序合并阅读；跨页作答请逐页添加。
                </p>
                <details
                  open={coordinatesOpen}
                  onToggle={(e) => setCoordinatesOpen(e.currentTarget.open)}
                >
                  <summary>精确调整坐标</summary>
                  {boxes.map((box, i) => (
                    <div className="p-region-editor" key={i}>
                      <strong>
                        第 {paper.items.findIndex((item) => item.id === box.itemId) + 1} 题 · 区域{" "}
                        {i + 1}
                      </strong>
                      {(["page", "x", "y", "width", "height"] as const).map((k) => (
                        <Field
                          key={k}
                          label={{ page: "页", x: "X", y: "Y", width: "宽", height: "高" }[k]}
                        >
                          <input
                            type="number"
                            disabled={busy}
                            min={k === "page" ? 1 : 0}
                            max={k === "page" ? files.length : 1}
                            step={k === "page" ? 1 : "any"}
                            value={box[k]}
                            onChange={(e) =>
                              setBoxes(
                                boxes.map((b, n) =>
                                  n === i ? { ...b, [k]: Number(e.target.value) } : b,
                                ),
                              )
                            }
                          />
                        </Field>
                      ))}
                      <button
                        disabled={busy || !boxes.slice(0, i).some((b) => b.itemId === box.itemId)}
                        type="button"
                        className="link-button"
                        onClick={() => {
                          const previous = boxes.findLastIndex(
                            (b, n) => n < i && b.itemId === box.itemId,
                          );
                          if (previous < 0) return;
                          const next = [...boxes];
                          [next[previous], next[i]] = [next[i], next[previous]];
                          setBoxes(next);
                        }}
                      >
                        本题区域上移
                      </button>
                      <button
                        disabled={busy}
                        type="button"
                        className="link-button"
                        onClick={() => setBoxes(boxes.filter((_, n) => n !== i))}
                      >
                        移除区域
                      </button>
                    </div>
                  ))}
                </details>
              </>
            )}
            <button
              className="button"
              type="submit"
              disabled={
                busy ||
                refreshFailed ||
                !!assessment?.published ||
                !!rosterUnconfirmed ||
                !files.length
              }
            >
              {busy ? "正在处理扫描…" : "上传并切题"}
            </button>
          </form>
          {imported !== null && (
            <div className="p-panel-content">
              <p className="p-notice" role="status">
                本批已导入 {imported} 份答卷。
                {refreshFailed
                  ? "列表暂未更新，请刷新记录。刷新只重新读取已保存的数据。"
                  : refreshing
                    ? "正在更新答卷记录…"
                    : "答卷记录已更新。"}
              </p>
              {refreshFailed && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={refreshing}
                  onClick={() => void refreshRecords()}
                >
                  {refreshing ? "正在刷新记录…" : "刷新记录"}
                </button>
              )}
            </div>
          )}
          {issues.length > 0 && (
            <div className="p-panel-content">
              <h3>需要处理的扫描件</h3>
              <p className="p-muted">
                本批扫描已处理完毕。请仅重新选择失败学生的全部页面后上传，多页答卷须按学生和页码组成完整页组。
              </p>
              {issues.map((issue, i) => (
                <div className="p-notice error" key={i}>
                  <strong>{issue.file}</strong>
                  <p>{issue.error}</p>
                  {issue.sourceUrl && (
                    <a href={issue.sourceUrl} target="_blank" rel="noreferrer">
                      查看已保存的原始扫描
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
      {(!section || section === "device") && (
        <Panel
          title="连接扫描仪"
          description={
            section === "device"
              ? "使用本机扫描仪桥接服务，支持 eSCL / SANE。扫描完成的图像按顺序加入上传页面的待上传列表。"
              : "使用本机扫描仪桥接服务，支持 eSCL / SANE。扫描完成的图像直接加入上方上传列表。"
          }
        >
          <div className="p-form">
            <div className="p-form-grid">
              <Field label="桥接服务地址">
                <input
                  type="url"
                  disabled={busy}
                  value={bridge}
                  onChange={(e) => setBridge(e.target.value)}
                />
              </Field>
              <Field label="访问令牌">
                <input
                  type="password"
                  disabled={busy}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="p-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void scanner("devices")}
              >
                查找扫描仪
              </button>
              {devices.length > 0 && (
                <select
                  aria-label="扫描仪"
                  disabled={busy}
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                >
                  <option value="">选择可用扫描仪</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id} disabled={Boolean(d.unavailable)}>
                      {d.name}
                      {d.unavailable ? "（不可用）" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {selectedDevice && (
              <>
                <div className="p-form-grid">
                  <Field
                    label="纸张来源"
                    hint={
                      selectedDevice.backend === "sane" || selectedDevice.id.startsWith("sane:")
                        ? "SANE 每次采集一页；多页可重复采集后一起上传。"
                        : "自动进纸可一次采集多页，请确认设备支持。"
                    }
                  >
                    <select
                      value={source}
                      disabled={busy}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="Platen">平板单页</option>
                      <option value="Feeder">自动进纸器</option>
                    </select>
                  </Field>
                  <Field label="扫描分辨率">
                    <select
                      value={resolution}
                      disabled={busy}
                      onChange={(e) => setResolution(Number(e.target.value))}
                    >
                      {[150, 200, 300, 600].map((value) => (
                        <option key={value} value={value}>
                          {value} DPI
                        </option>
                      ))}
                    </select>
                  </Field>
                  {batch && (
                    <>
                      <Field label="进纸方式" hint="双面采集要求扫描仪支持双面进纸。">
                        <select
                          value={duplex ? "duplex" : "simplex"}
                          disabled={busy}
                          onChange={(e) => setDuplex(e.target.value === "duplex")}
                        >
                          <option value="simplex">单面</option>
                          <option value="duplex">双面</option>
                        </select>
                      </Field>
                      <Field label="单次页数上限" hint="按采集顺序加入列表；每次上传最多 100 页。">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          disabled={busy}
                          value={maxPages}
                          onChange={(e) => setMaxPages(Number(e.target.value))}
                        />
                      </Field>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="button"
                  disabled={busy || Boolean(selectedDevice.unavailable) || files.length >= 100}
                  onClick={() => void scanner("scan")}
                >
                  {batch ? "批量扫描并添加图像" : "扫描并添加图像"}
                </button>
              </>
            )}
            <p className="p-muted">
              在连接扫描仪的电脑上运行{" "}
              <code>python3 scripts/scanner-bridge/bridge.py --origin http://localhost:3000</code>
              ，并将启动时生成的令牌填入此处。
            </p>
          </div>
          {section === "device" && (
            <div className="p-panel-content" role="status">
              <p>
                {files.length
                  ? `待上传 ${files.length} 页图像，尚未提交录入。`
                  : "暂无待上传图像。扫描完成的图像会加入待上传列表。"}
              </p>
              <Link className="button secondary" href="/exams/scanning/upload">
                前往上传页面
              </Link>
            </div>
          )}
        </Panel>
      )}
      {(!section || section === "history") && (
        <Panel title="已上传扫描" description="上传后的答卷与学生、考试关联，阅卷进度在此保留。">
          {state.submissions.length ? (
            <div className="p-table" role="region" aria-label="已上传扫描记录" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>学生</th>
                    <th>考试 / 科目</th>
                    <th>模式</th>
                    <th>状态</th>
                    <th>作答数量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.submissions.map((s) => {
                    const savedAssessment = state.assessments.find((a) => a.id === s.assessmentId);
                    const participant = savedAssessment
                      ? findAssessmentParticipant(savedAssessment, s.studentId)
                      : undefined;
                    const block = savedAssessment
                      ? assessmentReviewBlockReason(savedAssessment, s.studentId, s.paperId)
                      : "本次安排不可用";
                    const base = savedAssessment?.kind === "HOMEWORK" ? "/homework" : "/exams";
                    return (
                      <tr key={s.id}>
                        <td>{participant?.name ?? "待匹配学生"}</td>
                        <td>
                          {savedAssessment?.name} ·{" "}
                          {state.papers.find((p) => p.id === s.paperId)?.subject}
                        </td>
                        <td>{s.kind === "CARD" ? "答题卡" : "练习册"}</td>
                        <td>
                          <span className="p-status">
                            {block
                              ? "暂停评阅 · 原记录保留"
                              : { PENDING: "待阅卷", REVIEW: "评阅中", GRADED: "已阅卷" }[s.status]}
                          </span>
                          {submissionNeedsScanReview(s) && (
                            <span className="p-status">扫描需核对</span>
                          )}
                        </td>
                        <td>{s.answers.length}</td>
                        <td>
                          <div className="p-actions">
                            <Button asChild variant="outline" size="sm">
                              <Link href={`${base}/grading/${s.id}`}>查看答卷</Link>
                            </Button>
                            {(submissionNeedsScanReview(s) ||
                              (!block && s.status !== "GRADED")) && (
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  href={`${base}/grading/${s.id}#${submissionNeedsScanReview(s) ? "scan-materials" : "question-review"}`}
                                >
                                  {submissionNeedsScanReview(s) ? "核对扫描" : "继续阅卷"}
                                </Link>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>暂无扫描记录。</Empty>
          )}
        </Panel>
      )}
    </>
  );
}

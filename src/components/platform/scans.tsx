"use client";
import { DOCUMENT_UPLOAD_ACCEPT, type ScanUploadPage } from "@/contracts/uploads";
import { prepareScanPages, appendScanPages } from "@/lib/document-upload";
import { useState } from "react";
import type { Box, PlatformState } from "@/contracts/platform";
import { Empty, Field, Panel } from "./primitives";
import { apiRequest } from "@/lib/http-client";
import { useOptionalDomain } from "./domain-provider";
import { WorkbookCrop } from "./workbook-crop";
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
  const domain = useOptionalDomain();
  const files = domain?.scanFiles ?? localFiles;
  const setFiles = domain?.setScanFiles ?? setLocalFiles;
  const assessment = state.assessments.find((a) => a.id === assessmentId),
    paper = state.papers.find((p) => p.id === paperId),
    students = state.classrooms
      .filter((c) => assessment?.classroomIds.includes(c.id))
      .flatMap((c) => c.students)
      .filter((s) => !assessment?.studentIds || assessment.studentIds.includes(s.id));
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
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!files.length) throw new Error("请选择扫描件。");
      if (kind === "WORKBOOK") {
        if (
          !paper ||
          boxes.length !== paper.items.length ||
          new Set(boxes.map((b) => b.itemId)).size !== paper.items.length ||
          paper.items.some((item) => !boxes.some((b) => b.itemId === item.id))
        )
          throw new Error("请为每道题添加一个答题区域。");
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
      await refresh();
      if (!result.issues.length) setFiles([]);
      notify(
        `成功导入 ${result.imported} 份答卷${result.issues.length ? `，${result.issues.length} 项需要处理。` : "。请进入阅卷工作台。"}`,
        result.imported === 0,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "上传失败", true);
    } finally {
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
          <form className="p-form" onSubmit={upload}>
            <div className="p-form-grid">
              <Field label={fixedKind === "WORKBOOK" ? "作业安排" : "考试"}>
                <select
                  required
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
                  value={paperId}
                  onChange={(e) => {
                    setPaperId(e.target.value);
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
                disabled={busy}
                onChange={async (e) => {
                  const selected = Array.from(e.target.files ?? []);
                  e.currentTarget.value = "";
                  if (!selected.length) return;
                  setBusy(true);
                  try {
                    const pages = await prepareScanPages(selected);
                    setFiles(pages);
                    setBoxes([]);
                    setIssues([]);
                    notify(`已载入 ${pages.length} 页扫描材料。`);
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
            {kind === "WORKBOOK" && paper && (
              <>
                <h3>人工切题区域</h3>
                <WorkbookCrop
                  key={paper.id}
                  files={files}
                  paper={paper}
                  boxes={boxes}
                  onChange={setBoxes}
                  onAdd={() => setCoordinatesOpen(true)}
                />
                <p className="p-muted">
                  页面比例坐标 0–1，页码从 1 开始。请为每道题指定一个完整答题区域。
                </p>
                <details
                  open={coordinatesOpen}
                  onToggle={(e) => setCoordinatesOpen(e.currentTarget.open)}
                >
                  <summary>精确调整坐标</summary>
                  {boxes.map((box, i) => (
                    <div className="p-region-editor" key={i}>
                      <strong>
                        第 {paper.items.findIndex((item) => item.id === box.itemId) + 1} 题
                      </strong>
                      {(["page", "x", "y", "width", "height"] as const).map((k) => (
                        <Field
                          key={k}
                          label={{ page: "页", x: "X", y: "Y", width: "宽", height: "高" }[k]}
                        >
                          <input
                            type="number"
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
            <button className="button" type="submit" disabled={busy || !files.length}>
              {busy ? "正在处理扫描…" : "上传并切题"}
            </button>
          </form>
          {issues.length > 0 && (
            <div className="p-panel-content">
              <h3>需要处理的扫描件</h3>
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
          description="使用本机扫描仪桥接服务，支持 eSCL / SANE。扫描完成的图像直接加入上方上传列表。"
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
                  </tr>
                </thead>
                <tbody>
                  {state.submissions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {state.classrooms
                          .flatMap((c) => c.students)
                          .find((st) => st.id === s.studentId)?.name ?? "待匹配学生"}
                      </td>
                      <td>
                        {state.assessments.find((a) => a.id === s.assessmentId)?.name} ·{" "}
                        {state.papers.find((p) => p.id === s.paperId)?.subject}
                      </td>
                      <td>{s.kind === "CARD" ? "答题卡" : "练习册"}</td>
                      <td>
                        <span className="p-status">
                          {{ PENDING: "待阅卷", REVIEW: "待复核", GRADED: "已阅卷" }[s.status]}
                        </span>
                      </td>
                      <td>{s.answers.length}</td>
                    </tr>
                  ))}
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

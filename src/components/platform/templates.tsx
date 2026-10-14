"use client";
import Image from "next/image";
import { useState } from "react";
import { Printer, Plus } from "lucide-react";
import type { CardLayout, CardTemplate, Paper } from "@/contracts/platform";
import { Empty, Field, Panel, Submit } from "./primitives";
import type { Mutate } from "./questions";
import { generateCardTemplate, CARD_PRESETS } from "@/lib/cards";
import { apiRequest } from "@/lib/http-client";
function fromPaper(paper: Paper): CardLayout {
  return generateCardTemplate(paper).layout;
}
export function Templates({
  templates,
  papers,
  mutate,
  pending,
}: {
  templates: CardTemplate[];
  papers: Paper[];
  mutate: Mutate;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<CardTemplate | null | undefined>(),
    [selectedPaper, setSelectedPaper] = useState(papers[0]?.id ?? "");
  return (
    <>
      {editing !== undefined && (
        <TemplateEditor
          key={editing?.id ?? "new"}
          template={editing}
          papers={papers}
          presets={templates.filter((t) => t.preset)}
          mutate={mutate}
          pending={pending}
          close={() => setEditing(undefined)}
        />
      )}
      <Panel
        title="答题卡模板"
        description="提供九大学科预设，可按试卷题型调整答题区域、页数和卡号填涂区。"
        actions={
          <button className="button" disabled={!papers.length} onClick={() => setEditing(null)}>
            <Plus size={16} />
            制作答题卡
          </button>
        }
      >
        <div className="p-toolbar">
          <select
            aria-label="按试卷筛选模板"
            value={selectedPaper}
            onChange={(e) => setSelectedPaper(e.target.value)}
          >
            <option value="">全部试卷</option>
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {templates.filter((t) => !t.preset && (!selectedPaper || t.paperId === selectedPaper))
          .length ? (
          <div className="p-table" role="region" aria-label="答题卡模板列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>模板名称</th>
                  <th>对应试卷</th>
                  <th>页数 / 区域</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {templates
                  .filter((t) => !t.preset && (!selectedPaper || t.paperId === selectedPaper))
                  .map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.name}</strong>
                        <div className="p-muted">{t.subject}</div>
                      </td>
                      <td>{papers.find((p) => p.id === t.paperId)?.name}</td>
                      <td>
                        {t.layout.pageCount} 页 / {t.layout.regions.length} 区域
                      </td>
                      <td>
                        <div className="p-actions">
                          <button className="button secondary" onClick={() => setEditing(t)}>
                            编辑区域
                          </button>
                          <a
                            className="button secondary"
                            href={`/api/platform/print?templateId=${t.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Printer size={14} />
                            打印
                          </a>
                          <button
                            className="link-button"
                            disabled={pending}
                            onClick={() => {
                              if (window.confirm("删除答题卡模板？"))
                                void mutate({ type: "template.delete", id: t.id });
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>为已保存的试卷制作答题卡，打印后即可批量扫描并按题阅卷。</Empty>
        )}
        <div className="p-panel-content">
          <h3>学科预设</h3>
          <div className="p-tags">
            {templates
              .filter((t) => t.preset)
              .map((t) => (
                <span className="p-tag" key={t.id}>
                  {t.name}
                </span>
              ))}
          </div>
        </div>
      </Panel>
    </>
  );
}
function TemplateEditor({
  template,
  papers,
  presets,
  mutate,
  pending,
  close,
}: {
  template: CardTemplate | null;
  papers: Paper[];
  presets: CardTemplate[];
  mutate: Mutate;
  pending: boolean;
  close: () => void;
}) {
  const [paperId, setPaperId] = useState(template?.paperId ?? papers[0]?.id ?? ""),
    [layout, setLayout] = useState<CardLayout>(
      template?.layout ??
        (papers[0]
          ? fromPaper(papers[0])
          : {
              width: 794,
              height: 1123,
              pageCount: 1,
              markers: [],
              studentNumber: { digits: 6, x: 0.1, y: 0.1, cellWidth: 0.025, cellHeight: 0.02 },
              regions: [],
            }),
    ),
    [page, setPage] = useState(1),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const paper = papers.find((p) => p.id === paperId);
  const patchRegion = (index: number, field: string, value: string | number) =>
    setLayout({
      ...layout,
      regions: layout.regions.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    });
  async function uploadRegionImage(index: number, file?: File) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiRequest<{ url: string }>("/api/platform/assets", {
        method: "POST",
        body: form,
      });
      setLayout((current) => ({
        ...current,
        regions: current.regions.map((r, i) => (i === index ? { ...r, image: result.url } : r)),
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "配图上传失败。");
    } finally {
      setUploading(false);
    }
  }
  return (
    <Panel
      title={template ? "编辑答题卡" : "制作答题卡"}
      description="坐标为页面比例，取值 0–1。题区需避开页眉、学号和识别码；可恢复自动排布，支持多页答题卡。"
      actions={
        <button className="button secondary" onClick={close}>
          关闭编辑
        </button>
      }
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const saveCopy =
            (e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "saveCopy";
          const result = await mutate({
            type: "template.save",
            template: {
              id: saveCopy ? undefined : template?.id,
              paperId,
              name: String(d.get("name")),
              subject: paper?.subject ?? "数学",
              layout,
            },
          });
          if (result.error) return;
          close();
        }}
      >
        <div className="p-form">
          <div className="p-form-grid">
            <Field label="对应试卷">
              <select
                required
                value={paperId}
                onChange={(e) => {
                  setPaperId(e.target.value);
                  const p = papers.find((p) => p.id === e.target.value);
                  if (p) setLayout(fromPaper(p));
                }}
              >
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="模板名称">
              <input
                required
                name="name"
                defaultValue={template?.name ?? `${paper?.name ?? ""}答题卡`}
              />
            </Field>
            <Field label="应用学科预设">
              <select
                defaultValue=""
                onChange={(e) => {
                  const preset = presets.find((p) => p.id === e.target.value);
                  if (preset && paper) {
                    const sizing = CARD_PRESETS.find((p) => p.subject === preset.subject);
                    setLayout(generateCardTemplate(paper, sizing).layout);
                    setPage(1);
                  }
                }}
              >
                <option value="">按当前题型自动排布</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="页面数量">
              <input
                type="number"
                min={1}
                max={20}
                value={layout.pageCount}
                onChange={(e) => setLayout({ ...layout, pageCount: Number(e.target.value) })}
              />
            </Field>
          </div>
          <details>
            <summary>卡号填涂区与识别位点</summary>
            <div className="p-form-grid">
              <Field label="卡号位数">
                <input
                  type="number"
                  min={6}
                  max={6}
                  value={layout.studentNumber.digits}
                  onChange={(e) =>
                    setLayout({
                      ...layout,
                      studentNumber: { ...layout.studentNumber, digits: Number(e.target.value) },
                    })
                  }
                />
              </Field>
              {(["x", "y", "cellWidth", "cellHeight"] as const).map((k) => (
                <Field
                  label={
                    { x: "填涂区 X", y: "填涂区 Y", cellWidth: "单元格宽", cellHeight: "单元格高" }[
                      k
                    ]
                  }
                  key={k}
                >
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step="any"
                    value={layout.studentNumber[k]}
                    onChange={(e) =>
                      setLayout({
                        ...layout,
                        studentNumber: { ...layout.studentNumber, [k]: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="p-form-grid">
              {layout.markers.map((marker, i) => (
                <Field key={i} label={`识别位点 ${i + 1}（X, Y）`}>
                  <input
                    value={`${marker.x}, ${marker.y}`}
                    onChange={(e) => {
                      const [x, y] = e.target.value.split(",").map(Number);
                      if (Number.isFinite(x) && Number.isFinite(y))
                        setLayout({
                          ...layout,
                          markers: layout.markers.map((m, n) => (n === i ? { x, y } : m)),
                        });
                    }}
                  />
                </Field>
              ))}
            </div>
          </details>
        </div>
        <div className="p-split p-panel-content">
          <div>
            <div className="p-actions">
              <h3>题目答题区域</h3>
              <button
                type="button"
                className="button secondary"
                disabled={!paper}
                onClick={() => {
                  if (paper) {
                    setLayout(fromPaper(paper));
                    setPage(1);
                  }
                }}
              >
                按当前题型重新生成区域
              </button>
            </div>
            {uploadError && (
              <p role="alert" className="p-notice error">
                {uploadError}
              </p>
            )}
            {layout.regions.map((r, i) => (
              <div key={i}>
                <div className="p-question-head">
                  <strong>
                    第 {(paper?.items.findIndex((item) => item.id === r.itemId) ?? 0) + 1} 题
                  </strong>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      setLayout({ ...layout, regions: layout.regions.filter((_, n) => n !== i) })
                    }
                  >
                    移除区域
                  </button>
                </div>
                <div className="p-region-editor">
                  {(["page", "x", "y", "width", "height"] as const).map((k) => (
                    <Field
                      label={{ page: "页码", x: "X", y: "Y", width: "宽", height: "高" }[k]}
                      key={k}
                    >
                      <input
                        type="number"
                        min={k === "page" ? 1 : 0}
                        max={k === "page" ? layout.pageCount : 1}
                        step={k === "page" ? 1 : "any"}
                        value={r[k]}
                        onChange={(e) => patchRegion(i, k, Number(e.target.value))}
                      />
                    </Field>
                  ))}
                  <Field label="区域类型">
                    <select value={r.kind} onChange={(e) => patchRegion(i, "kind", e.target.value)}>
                      <option value="CHOICE">选择</option>
                      <option value="BLANK">填空</option>
                      <option value="WRITING">书写</option>
                    </select>
                  </Field>
                </div>
                <Field label="上传答题区配图（可选）" hint="上传题目材料图片后保存模板。">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploading}
                    onChange={(e) => void uploadRegionImage(i, e.target.files?.[0])}
                  />
                </Field>
                <Field label="答题区配图地址（可选）">
                  <input
                    value={r.image ?? ""}
                    onChange={(e) => patchRegion(i, "image", e.target.value)}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div>
            <div className="p-actions">
              <h3>布局预览</h3>
              <select
                aria-label="预览页码"
                value={page}
                onChange={(e) => setPage(Number(e.target.value))}
              >
                {Array.from({ length: layout.pageCount }, (_, i) => (
                  <option key={i} value={i + 1}>
                    第 {i + 1} 页
                  </option>
                ))}
              </select>
            </div>
            <div className="p-card-preview">
              {layout.markers.map((m, i) => (
                <span
                  className="p-fiducial"
                  key={i}
                  style={{
                    left: `${m.x * 100}%`,
                    top: `${m.y * 100}%`,
                    right: "auto",
                    bottom: "auto",
                  }}
                />
              ))}
              <div className="p-card-title">
                {paper?.name}
                <br />
                答题卡
              </div>
              <div
                className="p-card-region"
                style={{
                  left: `${layout.studentNumber.x * 100}%`,
                  top: `${layout.studentNumber.y * 100}%`,
                  width: `${layout.studentNumber.digits * layout.studentNumber.cellWidth * 100}%`,
                  height: `${11 * layout.studentNumber.cellHeight * 100}%`,
                }}
              >
                卡号填涂区
              </div>
              {layout.regions
                .filter((r) => r.page === page)
                .map((r, i) => (
                  <div
                    key={i}
                    className="p-card-region"
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.width * 100}%`,
                      height: `${r.height * 100}%`,
                    }}
                  >
                    第 {(paper?.items.findIndex((item) => item.id === r.itemId) ?? 0) + 1} 题
                    {r.image && (
                      <Image
                        unoptimized
                        width={1000}
                        height={1000}
                        alt="答题区配图"
                        src={r.image}
                        style={{ maxHeight: "70%", maxWidth: "100%" }}
                      />
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="p-form">
          <Submit pending={pending || uploading}>保存答题卡</Submit>
          {template && (
            <button
              type="submit"
              className="button secondary"
              name="saveCopy"
              disabled={pending || uploading}
            >
              另存为新答题卡
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

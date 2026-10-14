"use client";
import { DocumentExport } from "./document-export";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { ArrowRight, Plus, RotateCcw, Save, ScanLine } from "lucide-react";
import type { CardLayout, CardTemplate, Paper } from "@/contracts/platform";
import { generateCardTemplate, validateCardTemplate, fitAnnotationText } from "@/lib/cards";
import { renderCardSvg } from "@/lib/card-svg";
import { Textarea } from "@/components/ui/textarea";
import { DocumentFormatControls } from "./document-controls";
import { documentFont } from "@/lib/document-layout";
import { apiRequest } from "@/lib/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, Panel, Empty } from "./primitives";
import { useDomain } from "./domain-provider";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";

export function CardsListPage() {
  const { state } = useDomain();
  const [query, setQuery] = useState("");
  const templates = state.templates.filter(
    (t) => !t.preset && `${t.name} ${t.subject}`.includes(query),
  );
  return (
    <>
      <PageHeader
        title="答题卡工作台"
        description="按考试试卷制作答题卡，直接在卡面调整题区、学号填涂区和定位点。"
        actions={
          <Button asChild>
            <Link href="/exams/cards/new">
              <Plus />
              制作答题卡
            </Link>
          </Button>
        }
      />
      <Panel title="已制作的答题卡">
        <div className="p-toolbar">
          <Input
            aria-label="搜索答题卡"
            placeholder="搜索模板名称或学科"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {templates.length ? (
          <div className="p-table" role="region" aria-label="答题卡列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>模板名称</th>
                  <th>对应试卷</th>
                  <th>页面 / 题区</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/exams/cards/${t.id}`}>
                        <strong>{t.name}</strong>
                      </Link>
                      <small>{t.subject}</small>
                    </td>
                    <td>{state.papers.find((p) => p.id === t.paperId)?.name}</td>
                    <td>
                      {t.layout.pageCount} 页 / {t.layout.regions.length} 个题区
                    </td>
                    <td>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/exams/cards/${t.id}/edit`}>
                          进入排版
                          <ArrowRight />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-empty-action">
            <ScanLine size={30} />
            <h3>{query ? "没有匹配的答题卡" : "为试卷制作答题卡"}</h3>
            <p>先保存考试试卷，再生成完整题区布局。可在纸张画布上拖动、缩放和分页。</p>
            <Button asChild variant="outline">
              <Link href={state.papers.length ? "/exams/cards/new" : "/exams/papers/new"}>
                {state.papers.length ? "制作答题卡" : "先创建试卷"}
              </Link>
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}

function CardNavigation({ id, active }: { id: string; active: string }) {
  return (
    <PageTabs
      active={active}
      links={[
        { href: `/exams/cards/${id}`, label: "卡面概览" },
        { href: `/exams/cards/${id}/edit`, label: "可视化排版" },
        { href: `/exams/cards/${id}/export`, label: "导出与打印" },
      ]}
    />
  );
}

export function CardOverviewPage({ id, exporting = false }: { id: string; exporting?: boolean }) {
  const { state } = useDomain();
  const [page, setPage] = useState(1);
  const template = state.templates.find((t) => t.id === id && !t.preset);
  if (!template) return <MissingRecord back="/exams/cards" />;
  const paper = state.papers.find((p) => p.id === template.paperId);
  return (
    <>
      <PageHeader
        title={exporting ? "导出答题卡" : template.name}
        description={
          exporting
            ? "按实际尺寸打印，保留四角定位点和学号填涂区。请使用保存的同版式模板扫描。"
            : `${paper?.name ?? "考试试卷"} · ${template.layout.pageCount} 页 · ${template.layout.regions.length} 个题区`
        }
        back={{ href: "/exams/cards", label: "全部答题卡" }}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/exams/cards/${id}/edit`}>编辑卡面</Link>
            </Button>
            <DocumentExport templateId={id} />
          </>
        }
      />
      <CardNavigation id={id} active={`/exams/cards/${id}${exporting ? "/export" : ""}`} />
      <div className="p-toolbar">
        <select
          aria-label="预览答题卡页码"
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
        >
          {Array.from({ length: template.layout.pageCount }, (_, i) => (
            <option value={i + 1} key={i}>
              第 {i + 1} 页
            </option>
          ))}
        </select>
        <span className="p-muted">A4 · 实际打印版包含页面识别码</span>
      </div>
      <div className="p-card-preview">
        <CardSheet template={template} paper={paper} page={page} />
      </div>
    </>
  );
}

export function CardEditorPage({ id }: { id?: string }) {
  const { state } = useDomain();
  const template = state.templates.find((t) => t.id === id && !t.preset);
  if (id && !template) return <MissingRecord back="/exams/cards" />;
  return <CardWorkbench key={id ?? "new"} template={template} />;
}

type Selection = { kind: "region" | "marker" | "annotation"; index: number } | { kind: "number" };
function CardWorkbench({ template }: { template?: CardTemplate }) {
  const { state, mutate, pending } = useDomain();
  const router = useRouter();
  const [paperId, setPaperId] = useState(template?.paperId ?? state.papers[0]?.id ?? "");
  const paper = state.papers.find((p) => p.id === paperId);
  const [name, setName] = useState(template?.name ?? (paper ? `${paper.name}答题卡` : ""));
  const [layout, setLayout] = useState<CardLayout | undefined>(
    template?.layout ?? (paper ? generateCardTemplate(paper).layout : undefined),
  );
  const [selection, setSelection] = useState<Selection>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [fitPaper, setFitPaper] = useState(true);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const change = (next: CardLayout) => {
    setLayout(next);
    setDirty(true);
    setError("");
  };
  if (!paper || !layout)
    return (
      <>
        <PageHeader
          title="制作答题卡"
          description="先保存一份考试试卷，再按试题生成可排版的答题卡。"
          back={{ href: "/exams/cards", label: "答题卡工作台" }}
        />
        <div className="p-empty-action">
          <h3>需要一份已保存的考试试卷</h3>
          <Button asChild>
            <Link href="/exams/papers/new">创建试卷</Link>
          </Button>
        </div>
      </>
    );
  const reformat = (format: Parameters<typeof generateCardTemplate>[2]) => {
    try {
      change(generateCardTemplate(paper, {}, format).layout);
      setPage(1);
      setSelection(undefined);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "新纸张无法容纳当前内容，请调整文字或题区。",
      );
    }
  };
  const patchSelected = (field: string, value: number) => {
    if (!selection) return;
    if (selection.kind === "number")
      change({ ...layout, studentNumber: { ...layout.studentNumber, [field]: value } });
    else if (selection.kind === "marker")
      change({
        ...layout,
        markers: layout.markers.map((m, i) =>
          i === selection.index ? { ...m, [field]: value } : m,
        ),
      });
    else if (selection.kind === "annotation")
      change({
        ...layout,
        annotations: layout.annotations?.map((a, i) =>
          i === selection.index ? fitAnnotationText({ ...a, [field]: value }, layout) : a,
        ),
      });
    else
      change({
        ...layout,
        regions: layout.regions.map((r, i) =>
          i === selection.index ? { ...r, [field]: value } : r,
        ),
      });
  };
  const selected =
    selection?.kind === "region"
      ? layout.regions[selection.index]
      : selection?.kind === "marker"
        ? layout.markers[selection.index]
        : selection?.kind === "number"
          ? layout.studentNumber
          : selection?.kind === "annotation"
            ? layout.annotations?.[selection.index]
            : undefined;
  const current: CardTemplate = {
    id: template?.id ?? "draft",
    ownerId: state.actor.id,
    preset: false,
    paperId,
    subject: paper.subject,
    name,
    layout,
  };
  const locked = template && state.submissions.some((s) => s.templateId === template.id);
  async function save() {
    try {
      validateCardTemplate(current, paper);
    } catch (e) {
      setError(e instanceof Error ? e.message : "卡面布局无效。");
      return;
    }
    const r = await mutate({
      type: "template.save",
      template: {
        id: locked ? undefined : template?.id,
        paperId,
        name,
        subject: paper!.subject,
        layout: layout!,
      },
    });
    if (!r.error && r.id) {
      setDirty(false);
      router.push(`/exams/cards/${r.id}`);
    }
  }
  return (
    <>
      <PageHeader
        title={template ? "答题卡排版工作台" : "制作答题卡"}
        description="选择卡面元素后直接拖动位置；拖动题区右下角调整大小。方向键可以精细移动。"
        back={{
          href: template ? `/exams/cards/${template.id}` : "/exams/cards",
          label: template?.name ?? "全部答题卡",
        }}
      />
      {template && <CardNavigation id={template.id} active={`/exams/cards/${template.id}/edit`} />}
      {locked && <p className="p-notice">此模板已用于扫描，修改后另存为新模板。</p>}
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      <div className="p-paper-tools">
        <div className="p-actions">
          <Badge variant="secondary">
            {layout.pageCount} 页 · {layout.regions.length} 个题区
          </Badge>
          <span className={dirty ? "p-dirty" : "p-muted"}>
            {dirty ? "有未保存的修改" : "卡面草稿"}
          </span>
        </div>
        <div className="p-actions">
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm("恢复自动排布会覆盖当前题区位置，继续？")) {
                reformat(layout);
                setPage(1);
              }
            }}
          >
            <RotateCcw />
            自动排布
          </Button>
          <Button disabled={pending || !name.trim()} onClick={() => void save()}>
            <Save />
            {pending ? "正在保存…" : locked ? "另存新模板" : "保存答题卡"}
          </Button>
        </div>
      </div>
      <div className="p-card-workbench">
        <aside className="p-paper-outline">
          <h2>题区与页面</h2>
          {layout.regions.map((r, n) => (
            <button
              className={`p-card-outline-item${selection?.kind === "region" && selection.index === n ? " active" : ""}`}
              key={r.itemId}
              onClick={() => {
                setSelection({ kind: "region", index: n });
                setPage(r.page);
              }}
            >
              第 {n + 1} 题 <span>第 {r.page} 页</span>
            </button>
          ))}
        </aside>
        <div>
          <div className="p-document-ribbon">
            <Field label="纸张">
              <select
                value={layout.paperSize ?? "A4"}
                onChange={(e) => reformat({ ...layout, paperSize: e.target.value as "A4" | "A3" })}
              >
                <option>A4</option>
                <option>A3</option>
              </select>
            </Field>
            <DocumentFormatControls
              layout={{
                ...layout,
                paperSize: layout.paperSize ?? "A4",
                columns: layout.columns ?? 1,
              }}
              onChange={(value) => {
                if (value.orientation !== layout.orientation) {
                  reformat(value);
                  setPage(1);
                  setSelection(undefined);
                } else change({ ...layout, fontFamily: value.fontFamily });
              }}
            />
            <Field label="分栏">
              <select
                value={layout.columns ?? 1}
                onChange={(e) => {
                  reformat({ ...layout, columns: Number(e.target.value) });
                  setPage(1);
                  setSelection(undefined);
                }}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} 栏
                  </option>
                ))}
              </select>
            </Field>
            <Field label="当前页面">
              <select value={page} onChange={(e) => setPage(Number(e.target.value))}>
                {Array.from({ length: layout.pageCount }, (_, i) => (
                  <option value={i + 1} key={i}>
                    第 {i + 1} 页
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="outline"
              onClick={() => {
                const annotations = [
                  ...(layout.annotations ?? []),
                  {
                    id: crypto.randomUUID(),
                    text: "点击输入附加文字",
                    page,
                    x: 60 / layout.width,
                    y: 244 / layout.height,
                    width: (layout.width - 120) / layout.width,
                    height: 19.6 / layout.height,
                  },
                ];
                change({ ...layout, annotations });
                setSelection({ kind: "annotation", index: annotations.length - 1 });
              }}
            >
              添加文字
            </Button>
            <Button variant="outline" onClick={() => setFitPaper(!fitPaper)}>
              {fitPaper ? "100% 查看" : "适应屏幕"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                change({ ...layout, pageCount: layout.pageCount + 1 });
                setPage(layout.pageCount + 1);
              }}
            >
              <Plus />
              添加页面
            </Button>
          </div>
          <p className="p-card-interaction-hint">
            拖动题区位置，拖动右下角调整大小。精细调整可选择「100%
            查看」，或在卡面属性中填写位置和大小。
          </p>
          <div
            className={`p-card-preview${fitPaper ? "" : " is-full-size"}`}
            style={{ "--card-width": `${layout.width}px` } as CSSProperties}
          >
            <CardSheet
              template={current}
              paper={paper}
              page={page}
              selection={selection}
              select={setSelection}
              onChange={change}
            />
          </div>
        </div>
        <aside className="p-paper-bank">
          <h2>卡面属性</h2>
          <div className="p-paper-settings">
            <Button asChild variant="outline">
              <Link href={`/exams/papers/${paper.id}/edit`}>在对应试卷中添加或编辑题目</Link>
            </Button>
            <p className="p-muted">保存试卷后可重新生成题区；已布置的试卷会另存新版。</p>
            <Field label="答题卡名称">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="对应试卷">
              <select
                value={paperId}
                disabled={!!template}
                onChange={(e) => {
                  const p = state.papers.find((p) => p.id === e.target.value)!;
                  setPaperId(p.id);
                  setName(`${p.name}答题卡`);
                  change(generateCardTemplate(p).layout);
                  setPage(1);
                  setSelection(undefined);
                }}
              >
                {state.papers.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="总页数">
              <Input
                type="number"
                min={Math.max(...layout.regions.map((r) => r.page), 1)}
                max={100}
                value={layout.pageCount}
                onChange={(e) => {
                  const count = Number(e.target.value);
                  change({ ...layout, pageCount: count });
                  setPage(Math.min(page, count));
                }}
              />
            </Field>
          </div>
          <h2>
            {selection?.kind === "region"
              ? `第 ${selection.index + 1} 题`
              : selection?.kind === "marker"
                ? `定位点 ${selection.index + 1}`
                : selection?.kind === "number"
                  ? "学号填涂区"
                  : selection?.kind === "annotation"
                    ? "附加文字"
                    : "选择卡面元素"}
          </h2>
          {selected ? (
            <div className="p-paper-settings">
              {(["x", "y"] as const).map((field) => (
                <Field label={field === "x" ? "水平位置 (%)" : "垂直位置 (%)"} key={field}>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={Math.round(selected[field] * 1000) / 10}
                    onChange={(e) => patchSelected(field, Number(e.target.value) / 100)}
                  />
                </Field>
              ))}
              {selection?.kind === "annotation" && (
                <>
                  <Field label="文字内容">
                    <Textarea
                      value={layout.annotations?.[selection.index]?.text ?? ""}
                      onChange={(e) =>
                        change({
                          ...layout,
                          annotations: layout.annotations?.map((a, i) =>
                            i === selection.index
                              ? fitAnnotationText({ ...a, text: e.target.value }, layout)
                              : a,
                          ),
                        })
                      }
                    />
                  </Field>
                  {(["width", "height"] as const).map((field) => (
                    <Field key={field} label={field === "width" ? "文字宽度 (%)" : "文字高度 (%)"}>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        step={0.1}
                        value={(layout.annotations?.[selection.index]?.[field] ?? 0) * 100}
                        onChange={(e) => patchSelected(field, Number(e.target.value) / 100)}
                      />
                    </Field>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() => {
                      change({
                        ...layout,
                        annotations: layout.annotations?.filter((_, i) => i !== selection.index),
                      });
                      setSelection(undefined);
                    }}
                  >
                    删除文字
                  </Button>
                </>
              )}
              {selection?.kind === "region" && (
                <>
                  {(["width", "height"] as const).map((field) => (
                    <Field label={field === "width" ? "宽度 (%)" : "高度 (%)"} key={field}>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        step={0.1}
                        value={Math.round(layout.regions[selection.index][field] * 1000) / 10}
                        onChange={(e) => patchSelected(field, Number(e.target.value) / 100)}
                      />
                    </Field>
                  ))}
                  <Field label="题区配图（可选）">
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const form = new FormData();
                          form.set("file", file);
                          const result = await apiRequest<{ url: string }>("/api/platform/assets", {
                            method: "POST",
                            body: form,
                          });
                          change({
                            ...layout,
                            regions: layout.regions.map((r, n) =>
                              n === selection.index ? { ...r, image: result.url } : r,
                            ),
                          });
                        } catch (error) {
                          setError(error instanceof Error ? error.message : "配图上传失败。");
                        }
                      }}
                    />
                  </Field>
                  <Field label="所在页面">
                    <select
                      value={layout.regions[selection.index].page}
                      onChange={(e) => {
                        patchSelected("page", Number(e.target.value));
                        setPage(Number(e.target.value));
                      }}
                    >
                      {Array.from({ length: layout.pageCount }, (_, i) => (
                        <option key={i} value={i + 1}>
                          第 {i + 1} 页
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {selection?.kind === "number" && (
                <>
                  {(["cellWidth", "cellHeight"] as const).map((field) => (
                    <Field
                      key={field}
                      label={field === "cellWidth" ? "学号列间距 (%)" : "数字行间距 (%)"}
                    >
                      <Input
                        type="number"
                        step={0.1}
                        min={1}
                        max={10}
                        value={Math.round(layout.studentNumber[field] * 1000) / 10}
                        onChange={(e) => patchSelected(field, Number(e.target.value) / 100)}
                      />
                    </Field>
                  ))}
                </>
              )}
              <p className="p-muted">位置必须位于纸张内，题区不能相互覆盖或遮挡学号区和定位点。</p>
            </div>
          ) : (
            <Empty>点击题区、学号区或定位点，调整对应元素。</Empty>
          )}
        </aside>
      </div>
    </>
  );
}

function CardSheet({
  template,
  page,
  selection,
  select,
  onChange,
}: {
  template: CardTemplate;
  paper?: Paper;
  page: number;
  selection?: Selection;
  select?: (value?: Selection) => void;
  onChange?: (value: CardLayout) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | {
        selection: Selection;
        mode: "move" | "resize";
        startX: number;
        startY: number;
        layout: CardLayout;
      }
    | undefined
  >(undefined);
  const { layout } = template;
  const isSelected = (s: Selection) =>
    selection?.kind === s.kind &&
    (s.kind === "number" || (selection as { index: number }).index === s.index);
  function begin(
    event: PointerEvent<HTMLElement>,
    value: Selection,
    mode: "move" | "resize" = "move",
  ) {
    if (!onChange) return;
    event.preventDefault();
    event.stopPropagation();
    select?.(value);
    drag.current = {
      selection: value,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      layout: structuredClone(layout),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moving(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    const rect = ref.current?.getBoundingClientRect();
    if (!d || !rect || !onChange) return;
    const next = structuredClone(d.layout);
    const dx = (event.clientX - d.startX) / rect.width,
      dy = (event.clientY - d.startY) / rect.height;
    if (d.selection.kind === "region") {
      const r = next.regions[d.selection.index];
      if (d.mode === "resize") {
        r.width = Math.max(0.03, Math.min(1 - r.x, r.width + dx));
        r.height = Math.max(0.03, Math.min(1 - r.y, r.height + dy));
      } else {
        r.x = Math.max(0, Math.min(1 - r.width, r.x + dx));
        r.y = Math.max(0, Math.min(1 - r.height, r.y + dy));
      }
    } else if (d.selection.kind === "annotation") {
      const a = next.annotations![d.selection.index];
      a.x = Math.max(0, Math.min(1 - a.width, a.x + dx));
      a.y = Math.max(0, Math.min(1 - a.height, a.y + dy));
    } else if (d.selection.kind === "marker") {
      const m = next.markers[d.selection.index];
      m.x = Math.max(0.02, Math.min(0.98, m.x + dx));
      m.y = Math.max(0.02, Math.min(0.98, m.y + dy));
    } else {
      next.studentNumber.x = Math.max(0.01, Math.min(0.8, next.studentNumber.x + dx));
      next.studentNumber.y = Math.max(0.01, Math.min(0.8, next.studentNumber.y + dy));
    }
    onChange(next);
  }
  function keyboard(event: React.KeyboardEvent<HTMLElement>, value: Selection) {
    if (!onChange || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
      return;
    event.preventDefault();
    select?.(value);
    const next = structuredClone(layout);
    const node =
      value.kind === "region"
        ? next.regions[value.index]
        : value.kind === "marker"
          ? next.markers[value.index]
          : value.kind === "annotation"
            ? next.annotations![value.index]
            : next.studentNumber;
    const step = event.shiftKey ? 0.01 : 0.001;
    node.x += event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    node.y += event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    node.x = Math.max(
      0.01,
      Math.min(0.99 - (value.kind === "region" ? next.regions[value.index].width : 0), node.x),
    );
    node.y = Math.max(
      0.01,
      Math.min(0.99 - (value.kind === "region" ? next.regions[value.index].height : 0), node.y),
    );
    onChange(next);
  }

  const n = layout.studentNumber;
  return (
    <div
      ref={ref}
      className={`p-card-sheet${onChange ? " editable" : ""}`}
      style={{
        aspectRatio: `${layout.width}/${layout.height}`,
        fontFamily: documentFont(layout.fontFamily),
        maxWidth: `${layout.width}px`,
      }}
    >
      <div
        className="p-card-artwork"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderCardSvg(template, page, false) }}
      />
      {layout.markers.map((m, i) => {
        const value: Selection = { kind: "marker", index: i };
        return (
          <div
            key={i}
            tabIndex={onChange ? 0 : undefined}
            role={onChange ? "group" : undefined}
            onClick={() => select?.(value)}
            onPointerDown={(e) => begin(e, value)}
            onPointerMove={moving}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onKeyDown={(e) => keyboard(e, value)}
            aria-label={`定位点 ${i + 1}`}
            className={`p-card-marker${isSelected(value) ? " selected" : ""}`}
            style={{
              left: `${m.x * 100}%`,
              top: `${m.y * 100}%`,
              width: `${(14 / layout.width) * 100}%`,
              height: `${(14 / layout.height) * 100}%`,
            }}
          />
        );
      })}
      <div
        tabIndex={onChange ? 0 : undefined}
        role={onChange ? "group" : undefined}
        onClick={() => select?.({ kind: "number" })}
        onPointerDown={(e) => begin(e, { kind: "number" })}
        onPointerMove={moving}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onKeyDown={(e) => keyboard(e, { kind: "number" })}
        aria-label="六位学号填涂区"
        className={`p-card-number${isSelected({ kind: "number" }) ? " selected" : ""}`}
        style={{
          left: `${(n.x - 9 / layout.width) * 100}%`,
          top: `${(n.y - 25 / layout.height) * 100}%`,
          width: `${(n.cellWidth * 5 + 18 / layout.width) * 100}%`,
          height: `${(n.cellHeight * 9 + 34 / layout.height) * 100}%`,
        }}
      ></div>
      {layout.regions.map((r, index) => {
        if (r.page !== page) return null;
        const value: Selection = { kind: "region", index };

        return (
          <div
            key={r.itemId}
            tabIndex={onChange ? 0 : undefined}
            role={onChange ? "group" : undefined}
            onClick={() => select?.(value)}
            onPointerDown={(e) => begin(e, value)}
            onPointerMove={moving}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onKeyDown={(e) => keyboard(e, value)}
            aria-label={`第 ${index + 1} 题答题区`}
            className={`p-card-region${isSelected(value) ? " selected" : ""}`}
            style={
              {
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
              } as CSSProperties
            }
          >
            {onChange && (
              <button
                className="p-card-resize"
                aria-label={`缩放第 ${index + 1} 题答题区`}
                onPointerDown={(e) => begin(e, value, "resize")}
                onPointerMove={moving}
                onPointerUp={() => {
                  drag.current = undefined;
                }}
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const next = structuredClone(layout);
                  next.regions[index].width +=
                    e.key === "ArrowRight" ? 0.001 : e.key === "ArrowLeft" ? -0.001 : 0;
                  next.regions[index].height +=
                    e.key === "ArrowDown" ? 0.001 : e.key === "ArrowUp" ? -0.001 : 0;
                  onChange(next);
                }}
              />
            )}
          </div>
        );
      })}
      {(layout.annotations ?? [])
        .filter((a) => a.page === page)
        .map((a) => {
          const index = layout.annotations!.findIndex((t) => t.id === a.id);
          const value: Selection = { kind: "annotation", index };
          return (
            <div
              className={`p-card-annotation${isSelected(value) ? " selected" : ""}`}
              key={a.id}
              onClick={() => select?.(value)}
              style={{
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                width: `${a.width * 100}%`,
                height: `${a.height * 100}%`,
                fontSize: `${(14 / layout.width) * 100}cqw`,
              }}
            >
              {onChange && (
                <button
                  className="p-card-text-handle"
                  aria-label="拖动附加文字"
                  onPointerDown={(e) => begin(e, value)}
                  onPointerMove={moving}
                  onPointerUp={() => {
                    drag.current = undefined;
                  }}
                  onKeyDown={(e) => keyboard(e, value)}
                >
                  移动
                </button>
              )}
              {onChange && isSelected(value) && (
                <>
                  <Textarea
                    className="p-card-text-editor"
                    aria-label={`答题卡附加文字 ${index + 1}`}
                    value={a.text}
                    onChange={(e) =>
                      onChange({
                        ...layout,
                        annotations: layout.annotations?.map((t) =>
                          t.id === a.id
                            ? fitAnnotationText({ ...t, text: e.target.value }, layout)
                            : t,
                        ),
                      })
                    }
                  />
                  <button className="p-card-text-done" onClick={() => select?.(undefined)}>
                    完成文字编辑
                  </button>
                </>
              )}
              {onChange && !isSelected(value) && (
                <button
                  className="p-card-text-select"
                  aria-label={`编辑答题卡附加文字 ${index + 1}`}
                  onClick={() => select?.(value)}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

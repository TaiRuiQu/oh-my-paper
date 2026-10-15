"use client";
import { DocumentWorkbench } from "./document-workbench";
import { DocumentExport } from "./document-export";
import { BarcodeLabels } from "./barcode-labels";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useCallback, type PointerEvent, type CSSProperties } from "react";
import {
  ArrowRight,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Eye,
  Download,
  LockKeyhole,
  LockOpen,
  Copy,
  ArrowRightLeft,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Sparkles,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { CardLayout, CardTemplate, Paper } from "@/contracts/platform";
import { SUBJECTS } from "@/contracts/platform";
import {
  generateCardTemplate,
  validateCardTemplate,
  fitAnnotationText,
  studentNumberBox,
  cardPageHasHeader,
} from "@/lib/cards";
import { renderCardSvg } from "@/lib/card-svg";
import { Textarea } from "@/components/ui/textarea";
import { DocumentFormatControls } from "./document-controls";
import { documentFont } from "@/lib/document-layout";
import { apiRequest } from "@/lib/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Panel } from "./primitives";
import { useDomain } from "./domain-provider";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { usePaperZoom } from "./use-paper-zoom";
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
          <>
            <Button asChild variant="outline">
              <Link href="/exams/cards/ai">
                <Sparkles />
                AI 自动排版
              </Link>
            </Button>
            <Button asChild>
              <Link href="/exams/cards/new">
                <Plus />
                制作答题卡
              </Link>
            </Button>
          </>
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
            <p>从已有试卷生成，或新建空白答题卡，按题型添加作答区域。</p>
            <Button asChild variant="outline">
              <Link href="/exams/cards/new">制作答题卡</Link>
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
        className="p-document-export-heading"
        description={
          exporting
            ? "按实际尺寸打印，保留四角定位点和学号填涂区。请使用保存的同版式模板扫描。"
            : `${paper?.name ?? "考试试卷"} · ${template.layout.pageCount} 页 · ${template.layout.regions.length} 个题区`
        }
        back={{ href: "/exams/cards", label: "全部答题卡" }}
      />
      <CardNavigation id={id} active={`/exams/cards/${id}${exporting ? "/export" : ""}`} />
      <DocumentWorkbench
        title={template.name}
        status="卡面预览"
        outline={false}
        properties={false}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/exams/cards/${id}/edit`}>编辑卡面</Link>
            </Button>
            <DocumentExport template={template} />
          </>
        }
        ribbon={
          <div className="p-document-ribbon">
            <Field label="预览答题卡页码">
              <select value={page} onChange={(e) => setPage(Number(e.target.value))}>
                {Array.from({ length: template.layout.pageCount }, (_, i) => (
                  <option value={i + 1} key={i}>
                    第 {i + 1} 页
                  </option>
                ))}
              </select>
            </Field>
            <span className="p-muted">
              {template.layout.paperSize ?? "A4"} · 实际打印版包含页面识别码
            </span>
          </div>
        }
      >
        <div className="p-document-preview">
          <div>
            <div className="p-card-preview">
              <CardSheet template={template} paper={paper} page={page} />
            </div>
          </div>
        </div>
      </DocumentWorkbench>
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
const CARD_TYPES = [
  { label: "单选题", type: "SINGLE", style: "plain" },
  { label: "多选题", type: "MULTIPLE", style: "plain" },
  { label: "填空题", type: "BLANK", style: "plain" },
  { label: "解答题", type: "SUBJECTIVE", style: "plain" },
  { label: "语文作文", type: "SUBJECTIVE", style: "grid" },
  { label: "英语作文", type: "SUBJECTIVE", style: "lines" },
  { label: "混合题", type: "MIXED", style: "plain" },
  { label: "不定项选择题", type: "MULTIPLE", style: "plain" },
] as const;

function CardWorkbench({ template }: { template?: CardTemplate }) {
  const { state, mutate, pending } = useDomain();
  const router = useRouter();
  const [paperId, setPaperId] = useState(template?.paperId ?? state.papers[0]?.id ?? "");
  const sourcePaper = state.papers.find((p) => p.id === paperId);
  const [items, setItems] = useState(sourcePaper?.items ?? []);
  const paper = sourcePaper ? { ...sourcePaper, items } : undefined;
  const [name, setName] = useState(template?.name ?? (paper ? `${paper.name}答题卡` : ""));
  const [layout, setLayout] = useState<CardLayout | undefined>(
    template?.layout ?? (paper ? generateCardTemplate(paper).layout : undefined),
  );
  const [selection, setSelection] = useState<Selection>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const hasCard = !!paper && !!layout;
  const { zoom, fitWidth, setZoom, fitToWidth } = usePaperZoom(
    viewport,
    layout?.width ?? 794,
    hasCard,
  );
  function adjustZoom(step: number) {
    setZoom(Math.max(0.1, Math.min(3, Math.round((zoom + step) * 100) / 100)));
  }
  const [dirty, setDirty] = useState(false);
  const [paperDirty, setPaperDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState<(typeof CARD_TYPES)[number]>();
  const [dragged, setDragged] = useState<number>();
  const history = useRef<{ layout: CardLayout; items: Paper["items"]; paperDirty: boolean }[]>([]);
  const [historySize, setHistorySize] = useState(0);
  const historyBoundary = useRef(true);
  useUnsavedChanges(dirty);
  const change = useCallback(
    (next: CardLayout, nextItems = items) => {
      if (layout && historyBoundary.current) {
        history.current = [...history.current.slice(-39), { layout, items, paperDirty }];
        setHistorySize(history.current.length);
      }
      historyBoundary.current = false;
      setLayout(next);
      setItems(nextItems);
      setDirty(true);
      setError("");
    },
    [layout, items, paperDirty, setError, setHistorySize, setLayout, setItems, setDirty],
  );
  if (!paper || !layout)
    return (
      <>
        <PageHeader
          title="制作答题卡"
          description="选择一份试卷，自动生成答题区域，再按需要调整版式。"
          back={{ href: "/exams/cards", label: "全部答题卡" }}
        />
        <Panel
          title="新建空白答题卡"
          description="选择学科和名称，进入卡面后添加试题。系统同时建立一份对应试卷。"
        >
          <form
            className="p-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              const now = new Date().toISOString();
              const draft: Paper = {
                id: "draft",
                ownerId: state.actor.id,
                name: String(values.get("name")),
                kind: "EXAM",
                subject: String(values.get("subject")),
                grade: String(values.get("grade")),
                instructions: "",
                layout: { paperSize: "A4", columns: 1 },
                items: [],
                createdAt: now,
                updatedAt: now,
              };
              const result = await mutate({
                type: "paper.save",
                paper: {
                  name: draft.name,
                  kind: draft.kind,
                  subject: draft.subject,
                  grade: draft.grade,
                  instructions: draft.instructions,
                  layout: draft.layout,
                  items: [],
                },
              });
              if (result.id) {
                setPaperId(result.id);
                setItems([]);
                setName(`${draft.name}答题卡`);
                setLayout(generateCardTemplate(draft).layout);
                setDirty(true);
              }
            }}
          >
            <Field label="考试名称">
              <Input name="name" required maxLength={180} placeholder="例如：四下数学第一次月考" />
            </Field>
            <div className="p-form-grid">
              <Field label="学科">
                <select name="subject" defaultValue="数学">
                  {SUBJECTS.map((subject) => (
                    <option key={subject}>{subject}</option>
                  ))}
                </select>
              </Field>
              <Field label="适用年级">
                <Input name="grade" maxLength={40} placeholder="例如：四年级" />
              </Field>
            </div>
            <div className="p-actions">
              <Button disabled={pending} type="submit">
                {pending ? "正在创建…" : "开始制作"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/exams/papers/new">先编写试卷</Link>
              </Button>
            </div>
          </form>
        </Panel>
      </>
    );
  const scanLocked = !!template && state.submissions.some((s) => s.templateId === template.id);
  const editLocked = !!layout.locked;
  const current: CardTemplate = {
    id: template?.id ?? "draft",
    ownerId: state.actor.id,
    preset: false,
    paperId,
    subject: paper.subject,
    name,
    layout,
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
  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    setLayout(previous.layout);
    setItems(previous.items);
    setPaperDirty(previous.paperDirty);
    setHistorySize(history.current.length);
    setSelection(undefined);
    setPage(1);
    setDirty(true);
    historyBoundary.current = true;
  }
  function reformat(format: CardLayout, nextItems = items) {
    try {
      const generated = generateCardTemplate({ ...paper!, items: nextItems }, {}, format).layout;
      // Preserve question-specific materials and composition settings when rearranging.
      generated.regions = generated.regions.map((r) => {
        const previous = layout!.regions.find((old) => old.itemId === r.itemId);
        return {
          ...r,
          label: previous?.label,
          writingStyle: previous?.writingStyle,
          image: previous?.image ?? r.image,
        };
      });
      change(generated, nextItems);
      setPage(1);
      setSelection(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "当前版式无法容纳题目，请调整设置。");
    }
  }
  function patchSelected(field: string, value: number) {
    if (!selection) return;
    const next = structuredClone(layout!);
    if (selection.kind === "number") Object.assign(next.studentNumber, { [field]: value });
    else if (selection.kind === "marker")
      Object.assign(next.markers[selection.index], { [field]: value });
    else if (selection.kind === "region")
      Object.assign(next.regions[selection.index], { [field]: value });
    else
      next.annotations![selection.index] = fitAnnotationText(
        { ...next.annotations![selection.index], [field]: value },
        next,
      );
    change(next);
  }
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length || editLocked) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    reformat(layout!, next);
    setPaperDirty(true);
  }
  async function save(copy = false, useForExam = false) {
    const output = copy ? { ...current, name: `${name}（副本）`.slice(0, 200) } : current;
    if (!items.length) {
      setError("请先添加至少一道试题，再保存答题卡。");
      return;
    }
    try {
      validateCardTemplate(output, paper);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请检查卡面布局。");
      return;
    }
    const result = await mutate({
      type: "template.save",
      template: {
        id: copy || scanLocked || paperDirty ? undefined : template?.id,
        paperId,
        name: output.name,
        subject: paper!.subject,
        layout: layout!,
      },
      ...(paperDirty
        ? {
            paperDraft: {
              itemIds: items.map((i) => i.id),
              items: items.map((i) => ({
                questionId: i.questionId,
                score: i.score,
                section: i.section,
                question: {
                  type: i.snapshot.type,
                  subject: i.snapshot.subject,
                  grade: i.snapshot.grade,
                  difficulty: i.snapshot.difficulty,
                  knowledgeTags: i.snapshot.knowledgeTags,
                  content: i.snapshot.content,
                },
              })),
            },
          }
        : {}),
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.id) {
      setDirty(false);
      if (useForExam) {
        // A composed card may have created a paper revision; read its persisted association.
        const fresh = await apiRequest<import("@/contracts/platform").PlatformState>(
          "/api/platform/exams/state",
        );
        const saved = fresh.templates.find((t) => t.id === result.id);
        router.push(`/exams/new?paperId=${encodeURIComponent(saved?.paperId ?? paperId)}`);
      } else router.push(`/exams/cards/${result.id}/edit`);
    }
  }
  function download() {
    if (dirty || !template) {
      setError("请先保存答题卡，再下载用于打印和扫描的正式版。");
      return;
    }
    try {
      validateCardTemplate(current, paper);
      for (let p = 1; p <= layout!.pageCount; p++) {
        const url = URL.createObjectURL(
          new Blob([renderCardSvg(current, p)], { type: "image/svg+xml;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}-第${p}页.svg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败，请检查版式。");
    }
  }
  const addQuestions = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adding) return;
    const data = new FormData(event.currentTarget),
      count = Number(data.get("count")),
      score = Number(data.get("score")),
      optionCount = Number(data.get("options") ?? 4);
    const created = Array.from({ length: count }, (_, n) => {
      const id = crypto.randomUUID(),
        questionId = crypto.randomUUID();
      const content = {
        stem: `${adding.label} ${items.length + n + 1}（请补充题干）`,
        options:
          adding.type === "SINGLE" || adding.type === "MULTIPLE"
            ? Array.from({ length: optionCount }, (_, o) => ({
                label: String.fromCharCode(65 + o),
                text: `选项 ${String.fromCharCode(65 + o)}`,
              }))
            : [],
        answers: [],
        explanation: "",
        rubric: "",
        images: [],
        parts:
          adding.type === "MIXED"
            ? [
                {
                  id: crypto.randomUUID(),
                  type: "SUBJECTIVE" as const,
                  stem: "请补充子题",
                  options: [],
                  answers: [],
                  explanation: "",
                  rubric: "",
                  knowledgeTags: [],
                  score,
                },
              ]
            : [],
      };
      return {
        id,
        questionId,
        position: items.length + n,
        score,
        section: adding.label,
        snapshot: {
          id: questionId,
          ownerId: state.actor.id,
          subject: paper!.subject,
          grade: paper!.grade,
          type: adding.type,
          difficulty: 0.5,
          knowledgeTags: [],
          content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    });
    try {
      const nextItems = [...items, ...created];
      const next = generateCardTemplate({ ...paper!, items: nextItems }, {}, layout!).layout;
      next.regions = next.regions.map((r) => {
        const old = layout!.regions.find((o) => o.itemId === r.itemId);
        return {
          ...r,
          label: old?.label ?? (created.some((i) => i.id === r.itemId) ? adding.label : undefined),
          writingStyle:
            old?.writingStyle ??
            (created.some((i) => i.id === r.itemId) ? adding.style : undefined),
          image: old?.image ?? r.image,
        };
      });
      change(next, nextItems);
      setPaperDirty(true);
      setPage(next.regions.at(-1)!.page);
      setSelection({ kind: "region", index: nextItems.length - 1 });
      setAdding(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法添加题目。");
    }
  };
  const rail = (
    <>
      <div className="p-card-rail-scroll">
        <details className="p-maker-section p-maker-basic">
          <summary>基本信息</summary>
          <div className="p-maker-fields">
            <Field label="答题卡名称">
              <Input
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                disabled={editLocked}
              />
            </Field>
            <Field label="对应试卷">
              <select
                value={paperId}
                disabled={!!template || editLocked}
                onChange={(e) => {
                  if (dirty && !window.confirm("切换试卷将重新生成卡面，放弃当前修改？")) return;
                  const p = state.papers.find((p) => p.id === e.target.value)!;
                  setPaperId(p.id);
                  setItems(p.items);
                  setPaperDirty(false);
                  setName(`${p.name}答题卡`);
                  change(generateCardTemplate(p).layout, p.items);
                  setPage(1);
                  setSelection(undefined);
                  history.current = [];
                  setHistorySize(0);
                }}
              >
                {state.papers.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </details>
        <fieldset disabled={editLocked || pending} className="p-maker-fieldset">
          <section className="p-maker-section">
            <h3>选择纸张与版式</h3>
            <div className="p-maker-fields">
              <div className="p-segmented" role="group" aria-label="选择纸张">
                {(["A4", "A3"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={layout.paperSize === size}
                    onClick={() =>
                      reformat({
                        ...layout,
                        paperSize: size,
                        orientation: size === "A3" ? "landscape" : "portrait",
                      })
                    }
                  >
                    {size} 纸
                  </button>
                ))}
              </div>
              <div className="p-column-choices" role="group" aria-label="选择分栏">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={(layout.columns ?? 1) === n}
                    onClick={() =>
                      reformat({
                        ...layout,
                        columns: n,
                        ...(n > 1 && layout.paperSize === "A4"
                          ? { paperSize: "A3", orientation: "landscape" }
                          : {}),
                      })
                    }
                  >
                    <span className="p-column-icon">
                      {Array.from({ length: n }, (_, c) => (
                        <span key={c}>
                          {Array.from({ length: 5 }, (_, l) => (
                            <i key={l} />
                          ))}
                        </span>
                      ))}
                    </span>
                    <span>{["一栏", "两栏", "三栏"][n - 1]}</span>
                    {(layout.columns ?? 1) === n && <Check size={14} className="p-column-check" />}
                  </button>
                ))}
              </div>
              <p className="p-muted">A4 纵向，A3 横向；两栏、三栏默认使用 A3。</p>
              <details className="p-maker-advanced">
                <summary>字体设置</summary>
                <div className="p-maker-format">
                  <DocumentFormatControls
                    showOrientation={false}
                    layout={{
                      ...layout,
                      paperSize: layout.paperSize ?? "A4",
                      columns: layout.columns ?? 1,
                    }}
                    onChange={(v) => change({ ...layout, fontFamily: v.fontFamily })}
                  />
                </div>
              </details>
            </div>
          </section>
        </fieldset>
        <fieldset disabled={editLocked || pending} className="p-maker-fieldset">
          <section className="p-maker-section">
            <h3>顶部信息区</h3>
            <div className="p-maker-fields">
              <Field
                label="显示页面"
                hint="包含注意事项、班级姓名和考号区；切换后自动重新排布题区。"
              >
                <select
                  value={layout.headerMode ?? "EVERY_PAGE"}
                  onChange={(event) =>
                    reformat({
                      ...layout,
                      headerMode: event.target.value as CardLayout["headerMode"],
                    })
                  }
                >
                  <option value="EVERY_PAGE">每页都有</option>
                  <option value="ODD_PAGES">仅奇数页有（双面打印）</option>
                  <option value="FIRST_PAGE">只有第一页有（按顺序扫描）</option>
                </select>
              </Field>
            </div>
          </section>
        </fieldset>
        <section className="p-maker-section">
          <h3>选择考号版式</h3>
          <div className="p-maker-fields">
            <label className="p-radio-label">
              <input
                type="radio"
                disabled={editLocked || pending}
                checked={layout.studentNumber.mode !== "BARCODE"}
                name="number-style"
                onChange={() =>
                  change({ ...layout, studentNumber: { ...layout.studentNumber, mode: "OMR" } })
                }
              />
              准考证号填涂
            </label>
            <label className="p-radio-label">
              <input
                type="radio"
                disabled={editLocked || pending}
                checked={layout.studentNumber.mode === "BARCODE"}
                name="number-style"
                onChange={() =>
                  change({
                    ...layout,
                    studentNumber: { ...layout.studentNumber, mode: "BARCODE" },
                  })
                }
              />
              粘贴条形码
            </label>
            <p className="p-muted">
              {layout.studentNumber.mode === "BARCODE"
                ? "预留贴码区，扫描读取条码中的六位考号。"
                : "六位考号，每列填涂一个数字。"}
            </p>
            {layout.studentNumber.mode === "BARCODE" && (
              <BarcodeLabels
                key={`${layout.headerMode}-${layout.pageCount}`}
                pageCount={
                  Array.from({ length: layout.pageCount }, (_, index) => index + 1).filter((p) =>
                    cardPageHasHeader(layout, p),
                  ).length
                }
              />
            )}
            <button
              type="button"
              className="p-text-action"
              disabled={editLocked || pending}
              onClick={() => {
                if (!cardPageHasHeader(layout, page)) setPage(1);
                setSelection({ kind: "number" });
              }}
            >
              调整考号区位置与间距
            </button>
          </div>
        </section>
        <fieldset disabled={editLocked || pending} className="p-maker-fieldset">
          <section className="p-maker-section">
            <h3>设置禁止作答区</h3>
            <div className="p-maker-fields p-radio-row">
              <label className="p-radio-label">
                <input
                  type="radio"
                  name="absent"
                  checked={layout.showAbsent !== false}
                  onChange={() => change({ ...layout, showAbsent: true })}
                />
                启用
              </label>
              <label className="p-radio-label">
                <input
                  type="radio"
                  name="absent"
                  checked={layout.showAbsent === false}
                  onChange={() => change({ ...layout, showAbsent: false })}
                />
                禁用
              </label>
            </div>
          </section>
          <section className="p-maker-section">
            <h3>添加试题</h3>
            <div className="p-type-grid">
              {CARD_TYPES.map((type) => (
                <Button
                  type="button"
                  key={type.label}
                  variant="outline"
                  size="sm"
                  disabled={items.length >= 500}
                  onClick={() => setAdding(type)}
                >
                  <Plus size={12} />
                  {type.label}
                </Button>
              ))}
            </div>
          </section>
          <section className="p-maker-section">
            <h3>
              题目列表{" "}
              <span>
                {items.length} 题 · {items.reduce((sum, i) => sum + i.score, 0)} 分
              </span>
            </h3>
            <p className="p-maker-list-hint">拖动调整题序，点击题目设置答题区</p>
            <ol className="p-maker-question-list">
              {layout.regions.map((r, index) => {
                const item = items.find((i) => i.id === r.itemId);
                return (
                  <li
                    key={r.itemId}
                    draggable={!editLocked}
                    onDragStart={(e) => {
                      setDragged(index);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(index));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragged !== undefined) reorder(dragged, index);
                      setDragged(undefined);
                    }}
                    onDragEnd={() => setDragged(undefined)}
                    className={
                      selection?.kind === "region" && selection.index === index ? "active" : ""
                    }
                  >
                    <button
                      type="button"
                      className="p-maker-question-select"
                      onClick={() => {
                        setSelection({ kind: "region", index });
                        setPage(r.page);
                      }}
                    >
                      <GripVertical size={13} />
                      <span>
                        {index + 1}.{" "}
                        {r.label ??
                          (r.kind === "CHOICE"
                            ? r.multiple
                              ? "多选题"
                              : "单选题"
                            : r.kind === "BLANK"
                              ? "填空题"
                              : "解答题")}
                      </span>
                      <small>{item?.score ?? 0} 分</small>
                    </button>
                    <div className="p-maker-order">
                      <button
                        type="button"
                        aria-label={`上移第 ${index + 1} 题`}
                        disabled={index === 0}
                        onClick={() => reorder(index, index - 1)}
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={`下移第 ${index + 1} 题`}
                        disabled={index === items.length - 1}
                        onClick={() => reorder(index, index + 1)}
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          <section className="p-maker-section">
            <h3>卡面设置</h3>
            <label className="p-switch-row">
              显示学科名称
              <input
                role="switch"
                type="checkbox"
                checked={layout.showSubject !== false}
                onChange={(e) => change({ ...layout, showSubject: e.target.checked })}
              />
            </label>
            <label className="p-switch-row">
              添加页脚
              <input
                role="switch"
                type="checkbox"
                checked={layout.showFooter !== false}
                onChange={(e) => change({ ...layout, showFooter: e.target.checked })}
              />
            </label>
            <div className="p-maker-fields">
              <p className="p-muted">
                页面识别码始终保留，用于核对答题卡模板和页码；考号支持填涂或条形码识别。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const annotations = [
                    ...(layout.annotations ?? []),
                    {
                      id: crypto.randomUUID(),
                      text: "点击输入附加文字",
                      page,
                      x: 60 / layout.width,
                      y: (layout.height - 90) / layout.height,
                      width: (layout.width - 120) / layout.width,
                      height: 19.6 / layout.height,
                    },
                  ];
                  change({ ...layout, annotations });
                  setSelection({ kind: "annotation", index: annotations.length - 1 });
                }}
              >
                <Plus />
                添加文字
              </Button>
            </div>
          </section>
          {selected && (
            <section className="p-maker-section">
              <h3>
                {selection?.kind === "region"
                  ? `第 ${selection.index + 1} 题设置`
                  : selection?.kind === "number"
                    ? "考号区设置"
                    : selection?.kind === "annotation"
                      ? "附加文字"
                      : "定位点设置"}
                <button
                  type="button"
                  aria-label="关闭元素设置"
                  onClick={() => setSelection(undefined)}
                >
                  <X size={14} />
                </button>
              </h3>
              <div className="p-maker-fields">
                <div className="p-form-grid">
                  {(["x", "y"] as const).map((field) => (
                    <Field label={field === "x" ? "水平位置 %" : "垂直位置 %"} key={field}>
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
                </div>
                {selection?.kind === "region" && (
                  <>
                    <div className="p-form-grid">
                      {(["width", "height"] as const).map((field) => (
                        <Field key={field} label={field === "width" ? "宽度 %" : "高度 %"}>
                          <Input
                            type="number"
                            min={2}
                            max={100}
                            step={0.1}
                            value={Math.round(layout.regions[selection.index][field] * 1000) / 10}
                            onChange={(e) => patchSelected(field, Number(e.target.value) / 100)}
                          />
                        </Field>
                      ))}
                    </div>
                    <Field label="分值">
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        step={0.5}
                        value={items[selection.index]?.score ?? 0}
                        onChange={(e) => {
                          change(
                            layout,
                            items.map((item, n) =>
                              n === selection.index
                                ? { ...item, score: Number(e.target.value) }
                                : item,
                            ),
                          );
                          setPaperDirty(true);
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
                        {Array.from({ length: layout.pageCount }, (_, n) => (
                          <option key={n} value={n + 1}>
                            第 {n + 1} 页
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="题区配图">
                      <Input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const form = new FormData();
                            form.set("file", file);
                            const result = await apiRequest<{ url: string }>(
                              "/api/platform/assets",
                              { method: "POST", body: form },
                            );
                            change({
                              ...layout,
                              regions: layout.regions.map((r, n) =>
                                n === selection.index ? { ...r, image: result.url } : r,
                              ),
                            });
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "上传失败。");
                          }
                        }}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={items.length <= 1}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `删除第 ${selection.index + 1} 题？保存时会生成试卷修订版。`,
                          )
                        )
                          return;
                        reformat(
                          layout,
                          items.filter((_, n) => n !== selection.index),
                        );
                        setPaperDirty(true);
                      }}
                    >
                      <Trash2 />
                      删除此题
                    </Button>
                  </>
                )}
                {selection?.kind === "number" && layout.studentNumber.mode !== "BARCODE" && (
                  <div className="p-form-grid">
                    {(["cellWidth", "cellHeight"] as const).map((field) => (
                      <Field key={field} label={field === "cellWidth" ? "列间距 %" : "行间距 %"}>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          step={0.1}
                          value={Math.round(layout.studentNumber[field] * 1000) / 10}
                          onChange={(e) => patchSelected(field, Number(e.target.value) / 100)}
                        />
                      </Field>
                    ))}
                  </div>
                )}
                {selection?.kind === "annotation" && (
                  <>
                    <Field label="文字内容">
                      <Textarea
                        value={layout.annotations?.[selection.index]?.text ?? ""}
                        onChange={(e) =>
                          change({
                            ...layout,
                            annotations: layout.annotations?.map((a, n) =>
                              n === selection.index
                                ? fitAnnotationText({ ...a, text: e.target.value }, layout)
                                : a,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        change({
                          ...layout,
                          annotations: layout.annotations?.filter((_, n) => n !== selection.index),
                        });
                        setSelection(undefined);
                      }}
                    >
                      删除文字
                    </Button>
                  </>
                )}
                <p className="p-muted">题区应避开页眉、考号与定位点，不能互相重叠。</p>
              </div>
            </section>
          )}
        </fieldset>
      </div>
    </>
  );
  const dock = (
    <div className="p-maker-action-dock">
      <Button type="button" disabled={pending || !name.trim()} onClick={() => void save()}>
        <Save />
        {pending ? "保存中…" : scanLocked || paperDirty ? "保存为新版本" : "保存"}
      </Button>
      <Button type="button" variant="outline" onClick={() => setPreview(true)}>
        <Eye />
        预览
      </Button>
      <Button type="button" variant="outline" onClick={download}>
        <Download />
        下载
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-pressed={editLocked}
        onClick={() => {
          change({ ...layout, locked: !editLocked });
          setSelection(undefined);
        }}
      >
        {editLocked ? <LockOpen /> : <LockKeyhole />}
        {editLocked ? "解锁" : "锁定"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending || !name.trim()}
        onClick={() => void save(true)}
      >
        <Copy />
        复制为新卡
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending || !name.trim()}
        onClick={() => void save(false, true)}
      >
        <ArrowRightLeft />
        用于考试
      </Button>
    </div>
  );
  return (
    <div
      className="p-card-editor-page"
      onPointerDownCapture={() => {
        historyBoundary.current = true;
      }}
      onClickCapture={() => {
        historyBoundary.current = true;
      }}
      onKeyDownCapture={() => {
        historyBoundary.current = true;
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (!pending && name.trim()) void save();
        }
      }}
    >
      <PageHeader
        title="答题卡制作"
        description="设置版式、添加试题，直接在卡面调整作答区域。"
        back={{ href: "/exams/cards", label: "全部答题卡" }}
      />
      <DocumentWorkbench
        title={name.trim() || "答题卡"}
        status={
          <>
            <span className={`p-save-state${dirty ? " is-dirty" : ""}`}>
              {dirty ? "未保存" : template ? "已保存" : "草稿"}
            </span>
            <span>
              {items.length} 题 · {items.reduce((n, i) => n + i.score, 0)} 分
            </span>
          </>
        }
        outline={false}
        propertiesPanel={rail}
        panelActions={dock}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (dirty) {
                  setError("请先保存当前答题卡和试题，再使用 AI 自动排版。");
                  return;
                }
                router.push(`/exams/cards/ai?paperId=${encodeURIComponent(paperId)}`);
              }}
            >
              <Sparkles />
              AI 自动排版
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!historySize || editLocked}
              onClick={undo}
            >
              <Undo2 />
              撤销
            </Button>
          </>
        }
        notice={
          <>
            {scanLocked && <p className="p-notice">此卡已用于扫描，保存时会创建新版本。</p>}
            {paperDirty && (
              <p className="p-notice">
                题目已变更：保存时同步生成试卷修订版。新增题目需在对应试卷中补充题干与答案。
              </p>
            )}
            {error && (
              <p className="p-notice error" role="alert">
                {error}
              </p>
            )}
          </>
        }
      >
        <div className="p-card-stage">
          <div className="p-card-stage-toolbar">
            <div className="p-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </Button>
              <select
                aria-label="当前答题卡页面"
                value={page}
                onChange={(e) => {
                  setPage(Number(e.target.value));
                  setSelection(undefined);
                }}
              >
                {Array.from({ length: layout.pageCount }, (_, n) => (
                  <option key={n} value={n + 1}>
                    第 {n + 1} 页 / 共 {layout.pageCount} 页
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="下一页"
                disabled={page >= layout.pageCount}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <div className="p-actions">
              <div className="p-card-zoom" role="group" aria-label="画布缩放">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="缩小"
                  title="缩小"
                  disabled={zoom <= 0.1}
                  onClick={() => adjustZoom(-0.1)}
                >
                  <ZoomOut />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击恢复 100%`}
                  title="恢复 100%"
                  onClick={() => setZoom(1)}
                >
                  {Math.round(zoom * 100)}%
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="放大"
                  title="放大"
                  disabled={zoom >= 3}
                  onClick={() => adjustZoom(0.1)}
                >
                  <ZoomIn />
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={fitWidth}
                onClick={fitToWidth}
              >
                <ScanLine />
                适应宽度
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={editLocked || layout.pageCount >= 100}
                onClick={() => {
                  change({ ...layout, pageCount: layout.pageCount + 1 });
                  setPage(layout.pageCount + 1);
                }}
              >
                <Plus />
                加页
              </Button>
            </div>
          </div>
          <div
            ref={viewport}
            className="p-card-preview-scroll"
            role="region"
            aria-label="答题卡编辑画布"
            tabIndex={0}
          >
            <div
              className="p-card-preview"
              style={
                {
                  "--card-width": `${layout.width * zoom}px`,
                } as CSSProperties
              }
            >
              <CardSheet
                template={current}
                paper={paper}
                page={page}
                selection={selection}
                select={setSelection}
                onChange={editLocked ? undefined : change}
              />
            </div>
          </div>
          <footer className="p-card-stage-footer">
            <span>
              {layout.paperSize} · {layout.orientation === "landscape" ? "横向" : "纵向"} ·{" "}
              {layout.columns ?? 1} 栏
            </span>
            <span>
              {editLocked ? "卡面已锁定，解锁后继续编辑" : "点击选中 · 拖动移动 · 方向键微调"}
            </span>
            <button
              type="button"
              disabled={editLocked}
              onClick={() => {
                if (window.confirm("自动排布会覆盖当前题区位置，继续？")) reformat(layout);
              }}
            >
              <RotateCcw size={12} />
              自动排布
            </button>
          </footer>
        </div>
      </DocumentWorkbench>
      <Sheet open={!!adding} onOpenChange={(open) => !open && setAdding(undefined)}>
        <SheetContent side="right" className="p-add-question-sheet">
          <SheetHeader>
            <SheetTitle>添加{adding?.label}</SheetTitle>
            <SheetDescription>设置数量与分值，答题区域会自动排入卡面。</SheetDescription>
          </SheetHeader>
          <form className="p-form" onSubmit={addQuestions}>
            <Field label="题目数量">
              <Input
                name="count"
                type="number"
                min={1}
                max={Math.min(50, 500 - items.length)}
                defaultValue={1}
                required
              />
            </Field>
            <Field label="每题分值">
              <Input
                name="score"
                type="number"
                min={0}
                max={1000}
                step={0.5}
                defaultValue={adding?.type === "SUBJECTIVE" ? 10 : 5}
                required
              />
            </Field>
            {(adding?.type === "SINGLE" || adding?.type === "MULTIPLE") && (
              <Field label="每题选项数">
                <select name="options" defaultValue="4">
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} 个选项
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p className="p-muted">保存后可在对应试卷中完善新增题目的题干、答案和评分标准。</p>
            <Button type="submit" disabled={items.length >= 500}>
              <Plus />
              添加到答题卡
            </Button>
          </form>
        </SheetContent>
      </Sheet>
      <Sheet open={preview} onOpenChange={setPreview}>
        <SheetContent side="right" className="p-card-preview-sheet">
          <SheetHeader>
            <SheetTitle>答题卡预览</SheetTitle>
            <SheetDescription>
              {name} · 第 {page} 页 / 共 {layout.pageCount} 页{dirty ? " · 尚未保存" : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="p-preview-sheet-tools">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button
              variant="outline"
              disabled={page >= layout.pageCount}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
            {!dirty && template && <DocumentExport template={current} />}
          </div>
          <div className="p-card-preview">
            <CardSheet template={current} page={page} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
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

  const n = studentNumberBox(layout);
  return (
    <div
      ref={ref}
      className={`p-card-sheet${onChange ? " editable" : ""}`}
      style={
        {
          aspectRatio: `${layout.width}/${layout.height}`,
          fontFamily: documentFont(layout.fontFamily),
          "--card-natural-width": `${layout.width}px`,
        } as CSSProperties
      }
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
            role="group"
            onClick={() => select?.(value)}
            onPointerDown={(e) => begin(e, value)}
            onPointerMove={moving}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onPointerCancel={() => {
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
      {cardPageHasHeader(layout, page) && (
        <div
          tabIndex={onChange ? 0 : undefined}
          role="group"
          onClick={() => select?.({ kind: "number" })}
          onPointerDown={(e) => begin(e, { kind: "number" })}
          onPointerMove={moving}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onKeyDown={(e) => keyboard(e, { kind: "number" })}
          aria-label={
            layout.studentNumber.mode === "BARCODE" ? "考号条形码粘贴区" : "六位学号填涂区"
          }
          className={`p-card-number${isSelected({ kind: "number" }) ? " selected" : ""}`}
          style={{
            left: `${n.x * 100}%`,
            top: `${n.y * 100}%`,
            width: `${n.width * 100}%`,
            height: `${n.height * 100}%`,
          }}
        ></div>
      )}
      {layout.regions.map((r, index) => {
        if (r.page !== page) return null;
        const value: Selection = { kind: "region", index };

        return (
          <div
            key={r.itemId}
            tabIndex={onChange ? 0 : undefined}
            role="group"
            onClick={() => select?.(value)}
            onPointerDown={(e) => begin(e, value)}
            onPointerMove={moving}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onPointerCancel={() => {
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

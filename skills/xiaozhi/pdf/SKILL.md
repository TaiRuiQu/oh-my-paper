---
name: "pdf"
description: "Use when tasks involve reading, creating, or reviewing PDF files where rendering and layout matter; prefer visual checks by rendering pages (Poppler) and use Python tools such as `reportlab`, `pdfplumber`, and `pypdf` for generation and extraction."
---

# PDF Skill

## 小纸沙箱适配

此技能复制自 OpenAI 官方 PDF skill，并适配小纸运行环境。来源固定为 [openai/skills@49f948faa9258a0c61caceaf225e179651397431](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/pdf)，原文见 `references/upstream.md`，许可证见 `LICENSE.txt`。

- 用 `sandbox` 工具自主选择 Python `code` 或 shell `command` 执行；原始附件已只读挂载在消息附件清单的 `/inputs/...` 路径，PDF 未经转页、压缩或文字提取。
- ReportLab、pdfplumber、pypdf 与 Poppler（pdfinfo / pdftotext / pdftoppm）已经预装。沙箱无网络，不要在运行时执行安装命令。缺少依赖时如实报告。
- 可写目录为 `/workspace`；中间文件放在 `/workspace/tmp/pdfs/`，最终 PDF 放在 `/workspace/output/pdf/`。worker 恢复后可从原文件重建中间产物。
- 需要观察页面时，按需渲染到 `/workspace/output/`，在 `sandbox.images` 列出相对文件名（每次最多3个），工具会返回实际像素及授权资产URL；不必先把整份PDF转图。
- 交付生成的PDF时，在 `sandbox.files` 中列出相对 `/workspace/output/` 的PDF文件名。工具返回授权下载URL；回复中提供有意义的文件链接。路径与资产清单属于内部上下文，不要拼入用户消息。
- 上游关于视觉核对与提取工具的建议供自主选择；根据任务目标决定读取哪些页、使用哪些工具和何时结束，不构造固定教学工作流。

以下保留上游使用与质量指南；上游依赖安装及相对路径示例以本节预装环境与路径为准。

## When to use

- Read or review PDF content where layout and visuals matter.
- Create PDFs programmatically with reliable formatting.
- Validate final rendering before delivery.

## Workflow

1. Prefer visual review: render PDF pages to PNGs and inspect them.
   - Use `pdftoppm` if available.
   - If unavailable, install Poppler or ask the user to review the output locally.
2. Use `reportlab` to generate PDFs when creating new documents.
3. Use `pdfplumber` (or `pypdf`) for text extraction and quick checks; do not rely on it for layout fidelity.
4. After each meaningful update, re-render pages and verify alignment, spacing, and legibility.

## Temp and output conventions

- Use `tmp/pdfs/` for intermediate files; delete when done.
- Write final artifacts under `output/pdf/` when working in this repo.
- Keep filenames stable and descriptive.

## Dependencies (install if missing)

Prefer `uv` for dependency management.

Python packages:

```
uv pip install reportlab pdfplumber pypdf
```

If `uv` is unavailable:

```
python3 -m pip install reportlab pdfplumber pypdf
```

System tools (for rendering):

```
# macOS (Homebrew)
brew install poppler

# Ubuntu/Debian
sudo apt-get install -y poppler-utils
```

If installation isn't possible in this environment, tell the user which dependency is missing and how to install it locally.

## Environment

No required environment variables.

## Rendering command

```
pdftoppm -png $INPUT_PDF $OUTPUT_PREFIX
```

## Quality expectations

- Maintain polished visual design: consistent typography, spacing, margins, and section hierarchy.
- Avoid rendering issues: clipped text, overlapping elements, broken tables, black squares, or unreadable glyphs.
- Charts, tables, and images must be sharp, aligned, and clearly labeled.
- Use ASCII hyphens only. Avoid U+2011 (non-breaking hyphen) and other Unicode dashes.
- Citations and references must be human-readable; never leave tool tokens or placeholder strings.

## Final checks

- Do not deliver until the latest PNG inspection shows zero visual or formatting defects.
- Confirm headers/footers, page numbering, and section transitions look polished.
- Keep intermediate files organized or remove them after final approval.

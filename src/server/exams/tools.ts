import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolExecutionOptions } from "ai";
import { agentTool as tool } from "@/server/ai/agent-tool";
import sharp from "sharp";
import { AppError } from "@/server/errors";
import type { PageImage } from "./documents";
import {
  commandInputSchema,
  pythonInputSchema,
  createSandboxSession,
  type PythonInput,
} from "./python-sandbox";
const sessions = new WeakMap<object, ReturnType<typeof createSandboxSession>>();
export async function disposeInspectionTools(tools: object) {
  await sessions.get(tools)?.dispose();
}
export function createInspectionTools(
  pages: PageImage[],
  directory: string,
  signal?: AbortSignal,
  validatePageUpdates?: (numbers: number[]) => void,
) {
  const session = createSandboxSession({ pages, directory, signal });
  const findPage = (number: number) => {
    signal?.throwIfAborted();
    const page = pages.find((page) => page.page === number);
    if (!page)
      throw new AppError(
        `页面 ${number} 不存在，当前文档共有 ${pages.length} 页。`,
        "PAGE_NOT_FOUND",
        422,
      );
    return page;
  };
  const imageOutput = async (output: { images: string[] }) => ({
    type: "content" as const,
    value: [
      { type: "text" as const, text: JSON.stringify(output) },
      ...(await Promise.all(
        output.images.map(async (key) => ({
          type: "file" as const,
          mediaType: "image/jpeg",
          data: {
            type: "data" as const,
            data: (await readFile(join(directory, key))).toString("base64"),
          },
        })),
      )),
    ],
  });
  const executeSandbox = async (
    input: PythonInput | { command: string; images: string[] },
    { abortSignal }: ToolExecutionOptions<unknown>,
  ) => {
    const executionSignal =
      signal && abortSignal ? AbortSignal.any([signal, abortSignal]) : (signal ?? abortSignal);
    const lockedPages = pages
      .filter((page) => {
        try {
          validatePageUpdates?.([page.page]);
          return false;
        } catch (error) {
          if (error instanceof AppError && error.code === "PAGE_ALREADY_USED") return true;
          throw error;
        }
      })
      .map((page) => page.page);
    const { pageUpdates = [], ...result } = await session.run(input, {
      signal: executionSignal,
      lockedPages,
    });
    validatePageUpdates?.(pageUpdates.map((update) => update.page));
    const automatic = await Promise.all(
      pageUpdates.map(async (update) => {
        const key = `agent/${randomUUID()}.jpg`;
        const info = await sharp(Buffer.from(update.data, "base64"), {
          limitInputPixels: 45_000_000,
        })
          .flatten({ background: "white" })
          .jpeg({ quality: 95 })
          .toFile(join(directory, key));
        return {
          page: findPage(update.page),
          preview: { image: key, width: info.width, height: info.height },
        };
      }),
    );
    const previews = await Promise.all(
      result.images.map(async (output) => {
        const key = `agent/${randomUUID()}.jpg`;
        const info = await sharp(Buffer.from(output.data, "base64"), {
          limitInputPixels: 45_000_000,
        })
          .flatten({ background: "white" })
          .resize({ width: 2800, height: 2800, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 95 })
          .toFile(join(directory, key));
        return { name: output.name, image: key, width: info.width, height: info.height };
      }),
    );
    executionSignal?.throwIfAborted();
    // Recognition and Python may run concurrently in the same SDK round.
    validatePageUpdates?.(pageUpdates.map((update) => update.page));
    for (const { page, preview } of automatic)
      Object.assign(page, {
        path: join(directory, preview.image),
        width: preview.width,
        height: preview.height,
      });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      images: previews.map((preview) => preview.image),
      previews,
      pages: automatic.map(({ page, preview }) => ({
        page: page.page,
        width: page.width,
        height: page.height,
        image: preview.image,
      })),
    };
  };
  const tools = {
    shell: tool({
      description:
        "Execute any shell command in the agent's local sandbox without network. Installed commands are on PATH, including Python when available. Read pages at /workspace/pages/001.jpg and prior previews at /workspace/agent/<UUID>.jpg. To view a page or zoom into a region, copy or crop it to output/<name>.png and list the filename in images. Overwrite /workspace/pages/001.jpg directly to correct a whole page before saving material coordinates; later calls and final crops use the updated page automatically. Python and shell share a persistent 100 MiB writable workspace for this agent run. Files persist automatically across calls; processes start fresh. Each command has 60s wall time, 30s CPU and 512 MiB memory. Omit images when no extra previews are needed.",
      inputSchema: commandInputSchema,
      execute: executeSandbox,
      toModelOutput: ({ output }) => imageOutput(output),
    }),
    python: tool({
      description:
        "Run Python with NumPy, SciPy, SymPy, mpmath and Pillow in a local sandbox without network. Use these libraries for numerical or symbolic computation and print() for results. Pages are at /workspace/pages/001.jpg; previews at /workspace/agent/<UUID>.jpg. Use print() for text. To view a page or zoom into a region, copy or crop it to output/<name>.png and list the filename in images. Python and shell share a persistent 100 MiB workspace for this agent run. Files persist automatically across calls. Each command has 60s wall time and 512 MiB memory. To rotate a page, overwrite /workspace/pages/001.jpg directly before saving material coordinates; later calls and final crops use the updated page automatically. Omit images unless you want an extra preview.",
      inputSchema: pythonInputSchema,
      execute: executeSandbox,
      toModelOutput: ({ output }) => imageOutput(output),
    }),
  };
  sessions.set(tools, session);
  return tools;
}

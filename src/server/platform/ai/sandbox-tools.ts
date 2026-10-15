import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import sharp from "sharp";
import { createSandboxSession, sandboxImageNameSchema } from "@/server/ai/sandbox";
import { getStoragePaths } from "@/server/config/env";
import { AccessError } from "@/server/http/errors";
import { saveImage } from "../assets";

const parameters = {
  assets: z.array(z.string()).max(3).default([]),
  images: z.array(sandboxImageNameSchema).max(3).default([]),
};
type ExportedImage = { name: string; image: string; url?: string };

/** The only host data exported to an agent is an authorized task snapshot and selected assets. */
export function createTaskSandbox(options: {
  userId: string;
  context: unknown;
  allowedAssets: Set<string>;
  readAsset: (url: string) => Promise<Buffer>;
  onImages: (
    images: { name: string; buffer: Buffer; id: string; url: string }[],
    sources: string[],
  ) => Promise<void>;
  ensureOpen: () => void;
}) {
  let directory: string | undefined;
  let session: ReturnType<typeof createSandboxSession> | undefined;
  let starting: Promise<void> | undefined;
  let closed = false;
  let pending = Promise.resolve();
  const staged = new Set<string>();
  const buffers = new Map<string, Buffer>();
  const pathFor = (url: string) =>
    `/inputs/assets/${createHash("sha256").update(url).digest("hex")}.png`;
  const writeManifest = () =>
    writeFile(
      join(directory!, "inputs", "context.json"),
      JSON.stringify({
        task: options.context,
        assets: [...options.allowedAssets].map((url) => ({ url, path: pathFor(url) })),
      }),
      { mode: 0o600 },
    );
  const start = async () => {
    const root = join(getStoragePaths().temp, "ai-sandboxes");
    await mkdir(root, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(root, "task-"));
    await mkdir(join(directory, "inputs"), { mode: 0o700 });
    await mkdir(join(directory, "inputs", "assets"), { mode: 0o700 });
    await writeManifest();
    session = createSandboxSession({ directory });
  };
  const execute = async (
    input: { code?: string; command?: string; assets: string[]; images: string[] },
    { abortSignal }: { abortSignal?: AbortSignal },
  ) => {
    options.ensureOpen();
    abortSignal?.throwIfAborted();
    if (closed) throw new AccessError(403, "任务沙箱已关闭。");
    for (const url of input.assets)
      if (!options.allowedAssets.has(url)) throw new AccessError(403, "图像不属于当前任务。");
    starting ??= start();
    await starting;
    await writeManifest();
    for (const url of input.assets) {
      if (staged.has(url)) continue;
      const buffer = await options.readAsset(url);
      abortSignal?.throwIfAborted();
      const normalized = await sharp(buffer, { limitInputPixels: 50_000_000 }).png().toBuffer();
      await writeFile(join(directory!, "inputs", "assets", basename(pathFor(url))), normalized, {
        mode: 0o600,
      });
      staged.add(url);
      buffers.set(url, normalized);
    }
    const request =
      input.command !== undefined
        ? { command: input.command, images: input.images }
        : { code: input.code!, images: input.images };
    const output = await session!.run(request, { signal: abortSignal });
    // Trace URLs must resolve before the tool result is published, even if the task
    // later fails or never uses these images in its final business records.
    const images = await Promise.all(
      output.images.map(async (image) => ({
        name: image.name,
        ...(await saveImage(options.userId, Buffer.from(image.data, "base64"), image.name)),
      })),
    );
    if (output.exitCode === 0) await options.onImages(images, input.assets);
    // Requested originals are real model-visible evidence even when code emits an unrelated image.
    // Only this invocation's sources count as viewed; previously mounted inputs do not.
    const previews =
      output.exitCode === 0
        ? await Promise.all(
            input.assets.map(async (url) => ({
              url,
              image: (
                await sharp(buffers.get(url)!)
                  .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
                  .png()
                  .toBuffer()
              ).toString("base64"),
            })),
          )
        : [];
    return {
      exitCode: output.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
      assets: input.assets.map((url) => ({ url, path: pathFor(url) })),
      previews,
      images: await Promise.all(
        images.map(async (image) => ({
          name: image.name,
          image: (
            await sharp(image.buffer)
              .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
              .png()
              .toBuffer()
          ).toString("base64"),
          url: image.url,
        })),
      ),
    };
  };
  const serializedExecute = (
    input: Parameters<typeof execute>[0],
    context: Parameters<typeof execute>[1],
  ) => {
    const next = pending.then(() => execute(input, context));
    pending = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const toModelOutput = ({
    output,
  }: {
    output: {
      exitCode: number;
      stdout: string;
      stderr: string;
      assets: unknown[];
      images: ExportedImage[];
      previews: { url: string; image: string }[];
    };
  }) => ({
    type: "content" as const,
    value: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...output,
          previews: output.previews.map((preview) => ({ url: preview.url })),
          images: output.images.map((image) => ({
            name: image.name,
            ...(image.url ? { url: image.url } : {}),
          })),
        }),
      },
      ...output.images.map((image) => ({
        type: "file" as const,
        mediaType: "image/png",
        data: { type: "data" as const, data: image.image },
      })),
      ...output.previews.map((preview) => ({
        type: "file" as const,
        mediaType: "image/png",
        data: { type: "data" as const, data: preview.image },
      })),
    ],
  });
  const description =
    "Execute in this task's persistent Linux sandbox without network. /inputs/context.json contains authorized task data and the asset URL/path manifest. List up to 3 asset URLs in assets to mount their PNG files before executing; requested originals are also returned as visual previews. Files remain available for later calls. /inputs is read-only. Python and shell share a 100 MiB /workspace; files persist across calls, processes do not. Use print/stdout for text. To view an image, use Pillow/OpenCV to copy, crop, rotate or annotate an input into /workspace/output/<name>.png and list its filename in images (at most 3); the model receives the actual image pixels. Returned artifact URLs can be used as imported question illustrations. Do not attach an entire source page as an illustration. NumPy, SciPy, SymPy, mpmath and Pillow are installed. Each call has 60s wall time, 30s CPU and 512 MiB address space. Host files, secrets and network are unavailable.";
  return {
    tools: {
      python: tool({
        description: `Run Python code. ${description}`,
        inputSchema: z.object({ code: z.string().min(1).max(60000), ...parameters }),
        execute: serializedExecute,
        toModelOutput,
      }),
      shell: tool({
        description: `Execute a shell command. ${description}`,
        inputSchema: z.object({ command: z.string().min(1).max(60000), ...parameters }),
        execute: serializedExecute,
        toModelOutput,
      }),
    },
    async dispose() {
      closed = true;
      try {
        await starting?.catch(() => {});
        await session?.dispose();
        await pending;
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

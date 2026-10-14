import { build } from "esbuild";
import { nodeFileTrace } from "@vercel/nft";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const destination = resolve("build/ai-worker");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await build({
  entryPoints: ["scripts/ai-worker.ts"],
  outfile: resolve(destination, "worker.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  conditions: ["react-server"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  tsconfig: "tsconfig.json",
  sourcemap: true,
});
// Trace runtime dependencies including pnpm symlinks and native Sharp modules.
const trace = await nodeFileTrace([resolve(destination, "worker.mjs")], {
  base: process.cwd(),
  processCwd: process.cwd(),
  conditions: ["node", "react-server", "production"],
});
for (const file of trace.fileList) {
  if (file.startsWith("build/ai-worker/")) continue;
  const target = resolve(destination, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(file), target, {
    dereference: false,
    recursive: true,
    verbatimSymlinks: true,
  });
}
await writeFile(
  resolve(destination, "package.json"),
  JSON.stringify({ private: true, type: "module" }) + "\n",
);
await writeFile(
  resolve(destination, "runtime-files.json"),
  JSON.stringify([...trace.fileList].sort(), null, 2) + "\n",
);
console.log(`Built AI worker with ${trace.fileList.size} traced runtime files.`);

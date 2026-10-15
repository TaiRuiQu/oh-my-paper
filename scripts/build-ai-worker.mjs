import { build } from "esbuild";
import { nodeFileTrace } from "@vercel/nft";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const destination = resolve("build/ai-worker");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await build({
  entryPoints: { worker: "scripts/ai-worker.ts", "sandbox-check": "scripts/test-sandbox.ts" },
  outdir: destination,
  outExtension: { ".js": ".mjs" },
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
const trace = await nodeFileTrace(
  [resolve(destination, "worker.mjs"), resolve(destination, "sandbox-check.mjs")],
  {
    base: process.cwd(),
    processCwd: process.cwd(),
    conditions: ["node", "react-server", "production"],
  },
);
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
// Python programs are loaded by Bubblewrap rather than through JavaScript imports.
await cp(resolve("tools/sandbox"), resolve(destination, "tools/sandbox"), { recursive: true });
await cp(resolve("tools/card-scan"), resolve(destination, "tools/card-scan"), { recursive: true });
await writeFile(
  resolve(destination, "package.json"),
  JSON.stringify({ private: true, type: "module" }) + "\n",
);
await writeFile(
  resolve(destination, "runtime-files.json"),
  JSON.stringify([...trace.fileList].sort(), null, 2) + "\n",
);
console.log(`Built AI worker with ${trace.fileList.size} traced runtime files.`);

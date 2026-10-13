import { build } from "esbuild";
import { nodeFileTrace } from "@vercel/nft";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "build/worker");
await rm(output, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    "worker/index": "worker/index.ts",
    "scripts/worker-health": "scripts/worker-health.ts",
    "prisma.config": "prisma.config.ts",
  },
  outdir: output,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  conditions: ["react-server"],
});

// The same image runs migrations and its health check, so trace all three entry points.
const { fileList, warnings } = await nodeFileTrace(
  [
    join(output, "worker/index.mjs"),
    join(output, "scripts/worker-health.mjs"),
    join(output, "prisma.config.mjs"),
    join(root, "node_modules/prisma/build/index.js"),
  ],
  {
    base: root,
    processCwd: root,
    conditions: ["node", "react-server"],
    exportsOnly: true,
    // Runtime credentials and application data must never enter a build artifact.
    ignore: (path) =>
      /(^|\/)\.env(?:\.|$)/.test(path) ||
      /^(storage|tmp)\//.test(path) ||
      // The CLI requires @prisma/dev eagerly; only its local development database
      // assets are lazy and belong to `prisma dev`, never migrate deploy.
      /\/node_modules\/@prisma\/dev\/dist\/runtime-assets(?:\/|$)/.test(path),
  },
);

// Prisma computes its engine filename at runtime; the tracer cannot infer that path.
const prismaRequire = createRequire(
  await realpath(join(root, "node_modules/prisma/build/index.js")),
);
const engines = dirname(prismaRequire.resolve("@prisma/engines/package.json"));
const binaries = (await readdir(engines)).filter((file) => file.startsWith("schema-engine-"));
if (!binaries.length)
  throw new Error("Prisma migration engine is missing; install dependencies first.");
for (const file of binaries) fileList.add(relative(root, join(engines, file)));

// Preserve dependency license/notice files alongside each traced package manifest.
for (const path of [...fileList]) {
  if (!path.startsWith("node_modules/") || !path.endsWith("/package.json")) continue;
  for (const file of await readdir(join(root, dirname(path)))) {
    if (
      /^(licen[cs]e|copying|notice)(?:\.|$)/i.test(file) &&
      (await lstat(join(root, dirname(path), file))).isFile()
    ) {
      fileList.add(join(dirname(path), file));
    }
  }
}

const links = [];
for (const path of [...fileList].sort()) {
  if (!path.startsWith("node_modules/")) continue;
  const source = join(root, path);
  const target = join(output, path);
  if ((await lstat(source)).isSymbolicLink()) {
    links.push({ source, target });
  } else {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
}
// Copy pnpm links after their real files; preserve relative targets within the artifact.
for (const { source, target } of links) {
  const link = await readlink(source);
  const destination = resolve(dirname(source), link);
  const path = relative(root, destination);
  if (!path.startsWith("node_modules/")) throw new Error(`External dependency link: ${source}`);
  await mkdir(dirname(target), { recursive: true });
  await symlink(relative(dirname(target), join(output, path)), target);
}

for (const path of [
  "prisma/schema.prisma",
  "prisma/migrations",
  "tools/python/run.py",
  "tools/python/session.py",
]) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, path), target, { recursive: true });
}
const { name, version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await writeFile(
  join(output, "package.json"),
  JSON.stringify({ name, version, private: true }, null, 2) + "\n",
);
await writeFile(
  join(output, "trace.json"),
  JSON.stringify(
    {
      files: [...fileList].filter((path) => path.startsWith("node_modules/")).sort(),
      warnings: [...warnings].map(String),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Worker runtime written to ${relative(root, output)} (${fileList.size} traced paths).`);
console.log(`Trace diagnostics: ${warnings.size} (recorded in build/worker/trace.json).`);

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
for (const family of ["geist", "noto-sans-sc"]) {
  const source = dirname(require.resolve(`@fontsource-variable/${family}/package.json`));
  const destination = resolve("public/print-fonts", family);
  await mkdir(destination, { recursive: true });
  await cp(resolve(source, "files"), resolve(destination, "files"), { recursive: true });
  await writeFile(resolve(destination, "index.css"), await readFile(resolve(source, "index.css")));
  await cp(resolve(source, "LICENSE"), resolve(destination, "LICENSE"));
}
const katexSource = dirname(require.resolve("katex/package.json"));
const katexDestination = resolve("public/print-fonts/katex");
await mkdir(katexDestination, { recursive: true });
await cp(resolve(katexSource, "dist/fonts"), resolve(katexDestination, "fonts"), {
  recursive: true,
});
await cp(resolve(katexSource, "dist/katex.min.css"), resolve(katexDestination, "katex.min.css"));
await cp(resolve(katexSource, "LICENSE"), resolve(katexDestination, "LICENSE"));

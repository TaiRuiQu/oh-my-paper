import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxPython } from "@/server/exams/python-sandbox";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "paper-python-check-"));
  try {
    await mkdir(join(directory, "agent"));
    const result = await runSandboxPython({
      directory,
      pages: [],
      images: [],
      code: 'import PIL\nfrom PIL import Image\nassert Image.new("RGB", (1, 1)).size == (1, 1)\nprint("Pillow", PIL.__version__)',
    });
    if (result.exitCode !== 0) throw new Error(result.stderr);
    console.log(result.stdout.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

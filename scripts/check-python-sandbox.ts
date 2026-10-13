import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxSession } from "@/server/exams/python-sandbox";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "paper-python-check-"));
  await mkdir(join(directory, "agent"));
  const session = createSandboxSession({ directory, pages: [] });
  try {
    for (let call = 1; call <= 5; call++) {
      const result = await session.run({
        images: [],
        code: 'import PIL, importlib.util\nfrom PIL import Image\nassert Image.new("RGB", (1, 1)).size == (1, 1)\nprint("Pillow", PIL.__version__)\nif importlib.util.find_spec("numpy"):\n    import numpy as np\n    print("NumPy", np.ones((100, 100)).sum())\nif importlib.util.find_spec("cv2"):\n    import cv2, numpy as np\n    print("OpenCV", cv2.connectedComponentsWithStats(np.zeros((300, 500), dtype=np.uint8), 8)[0])',
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
      console.log(`Call ${call}: ${result.stdout.trim()}`);
    }
    const shell = await session.run({ images: [], command: "python3 -c 'print(\"shell works\")'" });
    if (shell.exitCode !== 0) throw new Error(shell.stderr);
    console.log(shell.stdout.trim());
  } finally {
    await session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

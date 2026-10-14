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
        code: 'import PIL, cv2, numpy as np, scipy, sympy as sp, mpmath as mp\nfrom PIL import Image\nfrom scipy.integrate import quad\nassert Image.new("RGB", (1, 1)).size == (1, 1)\nassert np.allclose(np.linalg.solve([[2, 1], [1, 2]], [3, 3]), [1, 1])\nassert abs(quad(lambda x: x*x, 0, 1)[0] - 1/3) < 1e-12\nx = sp.symbols("x")\nassert sp.solve(x*x - 4, x) == [-2, 2]\nassert mp.almosteq(mp.sqrt(2)**2, 2)\nprint("Pillow", PIL.__version__)\nprint("NumPy", np.__version__)\nprint("SciPy", scipy.__version__)\nprint("SymPy", sp.__version__)\nprint("mpmath", mp.__version__)\nprint("OpenCV", cv2.connectedComponentsWithStats(np.zeros((300, 500), dtype=np.uint8), 8)[0])',
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

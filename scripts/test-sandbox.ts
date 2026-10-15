import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxSession, verifySandboxEnvironment } from "../src/server/ai/sandbox";

async function main() {
  const environment = verifySandboxEnvironment();
  if (!environment.ok) throw new Error(`${environment.diagnostic} ${environment.remediation}`);
  const directory = await mkdtemp(join(tmpdir(), "omp-sandbox-test-"));
  const session = createSandboxSession({ directory });
  const evidence: string[] = [];
  try {
    await mkdir(join(directory, "inputs"), { mode: 0o700 });
    await writeFile(join(directory, "inputs", "context.json"), '{"authorized":true}', {
      mode: 0o600,
    });
    await writeFile(join(directory, "host-secret"), "not mounted");
    const first = await session.run({
      code: `import json, os, pathlib, socket
assert json.loads(pathlib.Path('/inputs/context.json').read_text())['authorized']
assert not pathlib.Path(${JSON.stringify(join(directory, "host-secret"))}).exists()
assert 'DATABASE_URL' not in os.environ
assert os.getuid() == 65534
try:
    pathlib.Path('/inputs/changed').write_text('forbidden')
    raise AssertionError('inputs writable')
except OSError:
    pass
try:
    socket.create_connection(('1.1.1.1', 80), timeout=1)
    raise AssertionError('network available')
except OSError:
    pass
print('isolation ok')`,
      images: [],
    });
    assert.equal(first.exitCode, 0, first.stderr);
    assert.match(first.stdout, /isolation ok/);
    evidence.push(
      "uid 65534, private network, host file/environment isolation, read-only authorized mode-600 inputs",
    );
    const protocol = await session.run({
      code: `import os, signal
parent = os.getppid()
for descriptor in [0, 1, 2]:
    try:
        os.open(f'/proc/{parent}/fd/{descriptor}', os.O_RDWR | os.O_NONBLOCK)
        raise AssertionError('supervisor descriptor accessible')
    except PermissionError:
        pass
signal.signal(signal.SIGCHLD, signal.SIG_IGN)
print('supervisor protocol protected')`,
      images: [],
    });
    assert.equal(protocol.exitCode, 0, protocol.stderr);
    assert.match(protocol.stdout, /supervisor protocol protected/);
    evidence.push(
      "supervisor protocol descriptors inaccessible through /proc; child signal changes cannot alter supervisor",
    );
    assert.equal(
      (await session.run({ command: "printf shared > /workspace/state.txt", images: [] })).exitCode,
      0,
    );
    const second = await session.run({
      code: `from pathlib import Path
from PIL import Image
import numpy, scipy, sympy, mpmath, cv2
assert Path('/workspace/state.txt').read_text() == 'shared'
Image.new('RGB', (16, 16), 'blue').save('/workspace/output/example.png')
print('dependencies ok')`,
      images: ["example.png"],
    });
    assert.equal(second.exitCode, 0, second.stderr);
    assert.equal(second.images[0].name, "example.png");
    assert.equal(Buffer.from(second.images[0].data, "base64").subarray(1, 4).toString(), "PNG");
    evidence.push(
      "persistent Python/shell workspace, preinstalled scientific libraries, actual PNG output",
    );
    const escape = await session.run({
      command: "ln -s /inputs/context.json /workspace/output/escape.png",
      images: ["escape.png"],
    });
    assert.equal(escape.exitCode, 1);
    assert.equal(escape.images.length, 0);
    assert.match(escape.stderr, /Cannot collect/);
    const bound = await session.run({
      code: "import sys; print('x'*100000); sys.stderr.write('y'*100000)",
      images: [],
    });
    assert.equal(bound.stdout.length, 32000);
    assert.equal(bound.stderr.length, 32000);
    const timeout = await session.run(
      { code: "import time; time.sleep(5)", images: [] },
      { timeoutMs: 100 },
    );
    assert.equal(timeout.exitCode, 124);
    assert.match(timeout.stderr, /100 毫秒/);
    assert.equal(
      (await session.run({ command: "cat /workspace/state.txt", images: [] })).stdout,
      "shared",
    );
    evidence.push(
      "image symlink rejection, bounded stdout/stderr, per-call timeout and recovery without filesystem loss",
    );
    const detached = await session.run({
      code: `import subprocess
subprocess.Popen(['/usr/bin/setsid', '/bin/sh', '-c', 'sleep 0.5; touch /workspace/leaked-child'])`,
      images: [],
    });
    assert.equal(detached.exitCode, 0, detached.stderr);
    const cleaned = await session.run({
      code: "import time,pathlib; time.sleep(0.8); assert not pathlib.Path('/workspace/leaked-child').exists(); print('children cleaned')",
      images: [],
    });
    assert.equal(cleaned.exitCode, 0, cleaned.stderr);
    evidence.push("background and detached descendant processes removed between calls");
    const quota = await session.run({
      code: `from pathlib import Path
try:
    Path('/workspace/huge').write_bytes(b'x' * (40 * 1024 * 1024))
    raise AssertionError('file size limit missing')
except OSError:
    print('file limit enforced')`,
      images: [],
    });
    assert.equal(quota.exitCode, 0, quota.stderr);
    assert.match(quota.stdout, /file limit enforced/);
    const abortController = new AbortController();
    const interrupted = session.run(
      { code: "import time; time.sleep(30)", images: [] },
      { signal: abortController.signal },
    );
    setTimeout(() => abortController.abort(new Error("intentional test abort")), 100);
    await assert.rejects(interrupted, /intentional test abort/);
    const recovered = await session.run({
      code: "from pathlib import Path; assert not Path('/workspace/state.txt').exists(); print('restart ok')",
      images: [],
    });
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.match(recovered.stdout, /已重启/);
    assert.match(recovered.stdout, /restart ok/);
    evidence.push("RLIMIT_FSIZE, AbortSignal cleanup, explicit filesystem-reset notice on restart");
    console.log(JSON.stringify({ ok: true, evidence }, null, 2));
  } finally {
    await session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

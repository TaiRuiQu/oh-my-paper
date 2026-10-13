"""Trusted output collector, executed inside Bubblewrap alongside model code."""

import base64
import contextlib
import io
import json
import pathlib
import sys
import traceback
import subprocess
import tempfile
import PIL  # Fail early if the configured runtime has no preinstalled Pillow.


class LimitedOutput(io.TextIOBase):
    def __init__(self):
        self.parts = []
        self.remaining = 32_000

    def write(self, text):
        if self.remaining:
            self.parts.append(text[: self.remaining])
        self.remaining = max(0, self.remaining - len(text))
        return len(text)

    def value(self):
        return "".join(self.parts)


request = json.load(sys.stdin)
pathlib.Path("/workspace/output").mkdir(exist_ok=True)
stdout, stderr = LimitedOutput(), LimitedOutput()
exit_code = 0
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    try:
        if "command" in request:
            # Files bound memory usage even when a command writes a large amount.
            # prlimit also bounds their size; Bubblewrap contains every child.
            with tempfile.TemporaryFile(dir="/tmp") as out, tempfile.TemporaryFile(dir="/tmp") as err:
                result = subprocess.run(
                    ["/bin/sh", "-c", request["command"]], stdout=out, stderr=err
                )
                exit_code = result.returncode
                out.seek(0)
                err.seek(0)
                stdout.write(out.read(32_000).decode("utf-8", errors="replace"))
                stderr.write(err.read(32_000).decode("utf-8", errors="replace"))
        else:
            exec(compile(request["code"], "model.py", "exec"), {"__name__": "__main__"})
    except BaseException:
        exit_code = 1
        traceback.print_exc()

images = []
if exit_code == 0:
    try:
        for name in request["images"]:
            path = pathlib.Path("/workspace/output") / name
            if path.stat().st_size > 8 * 1024 * 1024:
                raise ValueError(f"Output image {name} exceeds 8 MiB")
            images.append({"name": name, "data": base64.b64encode(path.read_bytes()).decode()})
    except BaseException:
        exit_code = 1
        with contextlib.redirect_stderr(stderr):
            traceback.print_exc()
        images = []

print(json.dumps({"exitCode": exit_code, "stdout": stdout.value(), "stderr": stderr.value(), "images": images}))

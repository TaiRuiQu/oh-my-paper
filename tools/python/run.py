"""Trusted output collector, executed inside Bubblewrap alongside model code."""

import base64
import contextlib
import io
import json
import pathlib
import sys
import traceback
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


request = json.loads(pathlib.Path("/runtime/request.json").read_text())
pathlib.Path("/workspace/output").mkdir()
stdout, stderr = LimitedOutput(), LimitedOutput()
exit_code = 0
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    try:
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

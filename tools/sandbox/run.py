"""Untrusted model code runs in a fresh child; the parent collects images after cleanup."""
import json
import subprocess
import sys
import traceback

request = json.load(sys.stdin)
try:
    if "command" in request:
        sys.exit(subprocess.run(["/bin/sh", "-c", request["command"]]).returncode)
    exec(compile(request["code"], "model.py", "exec"), {"__name__": "__main__"})
except SystemExit:
    raise
except BaseException:
    traceback.print_exc()
    sys.exit(1)

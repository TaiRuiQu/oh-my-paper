"""Trusted persistent supervisor inside a private Bubblewrap namespace."""
import base64
import ctypes
import io
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import tempfile
from PIL import Image

ROOT = pathlib.Path('/workspace')
(ROOT / '.tmp').mkdir()
(ROOT / 'output').mkdir()
# Child code must not access the supervisor's protocol descriptors via /proc.
if ctypes.CDLL(None).prctl(4, 0, 0, 0, 0) != 0:  # PR_SET_DUMPABLE
    raise RuntimeError('Cannot protect sandbox supervisor')
Image.MAX_IMAGE_PIXELS = 25_000_000


def collect_image(name):
    if not isinstance(name, str) or len(name) > 200 or not re.fullmatch(
        r'[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.(?:png|jpe?g|webp)', name
    ):
        raise ValueError('Invalid output image path')
    parts = ['output'] + name.split('/')
    descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if index < len(parts) - 1:
                flags |= os.O_DIRECTORY
            next_descriptor = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 8 * 1024 * 1024:
            raise ValueError('Output image must be a regular file no larger than 8 MiB')
        with os.fdopen(os.dup(descriptor), 'rb') as source:
            data = source.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError('Output image exceeds 8 MiB')
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 50_000_000:
                raise ValueError('Output image exceeds 50 million pixels')
            image.verify()
        return {'name': name, 'data': base64.b64encode(data).decode()}
    finally:
        os.close(descriptor)


def cleanup(child):
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()
    # /proc is private to this namespace. Also kill commands detached by setsid().
    for _ in range(4):
        for entry in pathlib.Path('/proc').iterdir():
            if not entry.name.isdigit() or int(entry.name) in (1, os.getpid()):
                continue
            try:
                os.kill(int(entry.name), signal.SIGKILL)
            except ProcessLookupError:
                pass


for line in sys.stdin:
    try:
        request = json.loads(line)
        timeout = request.pop('timeoutMs') / 1000
        if not 0 < timeout <= 60:
            raise ValueError('Invalid sandbox timeout')
        if len(request.get('images', [])) > 3:
            raise ValueError('At most three images can be returned')
        with tempfile.TemporaryFile(dir='/tmp') as out, tempfile.TemporaryFile(dir='/tmp') as err:
            child = subprocess.Popen([
                '/usr/bin/prlimit', '--as=536870912', '--cpu=30', '--nproc=64',
                '--nofile=64', '--fsize=37748736', '--core=0', '--',
                sys.executable, '-I', '/runtime/run.py',
            ], stdin=subprocess.PIPE, stdout=out, stderr=err, start_new_session=True)
            timed_out = False
            try:
                child.communicate(input=json.dumps(request).encode(), timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
            finally:
                cleanup(child)
            out.seek(0)
            err.seek(0)
            stdout = out.read(32000).decode('utf-8', errors='replace')[:32000]
            stderr = err.read(32000).decode('utf-8', errors='replace')[:32000]
        images = []
        exit_code = child.returncode
        if timed_out:
            exit_code = 124
            stderr = f'沙箱执行超过 {int(timeout * 1000)} 毫秒，进程已终止。\n' + stderr
        elif exit_code == 0:
            try:
                images = [collect_image(name) for name in request.get('images', [])]
            except BaseException as error:
                exit_code = 1
                stderr = f'Cannot collect sandbox images: {error}\n' + stderr
        response = {'result': {'exitCode': exit_code, 'stdout': stdout, 'stderr': stderr[:32000], 'images': images}}
    except BaseException as error:
        response = {'failure': str(error)[:1000]}
    print(json.dumps(response), flush=True)

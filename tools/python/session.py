"""One Bubblewrap workspace per agent; run each request in a bounded child."""
import base64
import hashlib
import shutil
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile

workspace = pathlib.Path('/workspace')
(workspace / '.tmp').mkdir()
(workspace / 'pages').mkdir(exist_ok=True)
(workspace / 'output').mkdir()

versions = {}
for line in sys.stdin:
    try:
        request = json.loads(line)
        pages = request.pop('pages')
        for page in pages:
            path = workspace / 'pages' / page['name']
            if page['name'] not in versions or page['refresh']:
                shutil.copyfile(page['target'], path)
                versions[page['name']] = hashlib.sha256(path.read_bytes()).digest()
        timeout = request.pop('timeoutMs') / 1000
        with tempfile.TemporaryFile(dir='/tmp') as out, tempfile.TemporaryFile(dir='/tmp') as err:
            child = subprocess.Popen(
                ['/usr/bin/prlimit', '--as=536870912', '--cpu=30', '--nproc=64',
                 '--nofile=64', '--fsize=37748736', '--core=0', '--',
                 sys.executable, '-I', '/runtime/run.py'],
                stdin=subprocess.PIPE, stdout=out, stderr=err, start_new_session=True,
            )
            timed_out = False
            try:
                child.communicate(input=json.dumps(request).encode(), timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
            finally:
                # Clean up background commands too, while retaining workspace files.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
                # A command may detach with setsid(). /proc is private to
                # this Bubblewrap namespace: retain only init and this server.
                for _ in range(3):
                    for pid in sorted(int(entry.name) for entry in pathlib.Path('/proc').iterdir() if entry.name.isdigit()):
                        if pid in (1, os.getpid()):
                            continue
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            out.seek(0)
            err.seek(0)
            if timed_out:
                response = {'failure': f'沙箱执行超过 {int(timeout * 1000)} 毫秒，进程已终止。'}
            elif child.returncode:
                response = {'failure': f'沙箱进程运行失败（退出码：{child.returncode}）。' + err.read(1000).decode('utf-8', errors='replace')}
            else:
                response = {'result': json.loads(out.read(36 * 1024 * 1024))}
        if 'result' in response:
            updates = []
            for page in pages:
                path = workspace / 'pages' / page['name']
                data = path.read_bytes() if path.is_file() else b''
                digest = hashlib.sha256(data).digest()
                if digest == versions[page['name']]:
                    continue
                if page['locked'] or not data or len(data) > 8 * 1024 * 1024:
                    shutil.copyfile(page['target'], path)
                    versions[page['name']] = hashlib.sha256(path.read_bytes()).digest()
                    raise ValueError('该页面已有材料坐标、已删除或超过 8 MiB；修改已撤销。')
                updates.append({'page': page['page'], 'data': base64.b64encode(data).decode()})
                versions[page['name']] = digest
            response['result']['pageUpdates'] = updates
    except BaseException as error:
        response = {'failure': str(error)[:1000]}
    print(json.dumps(response), flush=True)

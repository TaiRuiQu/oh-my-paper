#!/usr/bin/env python3
"""Repair and verify the deployed AI sandbox; run explicitly as root on the Docker host."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
POLICY = Path("/etc/sysctl.d/99-oh-my-paper-sandbox.conf")
COMPOSE = ["docker", "compose", "-f", "compose.yaml", "-f", "compose.release.yaml"]
PROBE = COMPOSE + [
    "run", "--rm", "--no-deps", "-T", "ai-worker",
    "node", "--conditions=react-server", "sandbox-check.mjs",
]
SECURITY_OPTIONS = {
    "no-new-privileges=true", "seccomp=unconfined", "apparmor=unconfined", "systempaths=unconfined",
}


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, **kwargs)


def validate_compose():
    result = run(COMPOSE + ["config", "--format", "json"], check=True, capture_output=True, text=True)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    worker = json.loads(result.stdout).get("services", {}).get("ai-worker", {})
    configured = {option.replace(":", "=", 1) for option in worker.get("security_opt", [])}
    missing = sorted(SECURITY_OPTIONS - configured)
    if "ALL" not in worker.get("cap_drop", []):
        missing.append("cap_drop: [ALL]")
    if missing:
        raise RuntimeError(
            "Compose 的 ai-worker 缺少必要安全配置：" + ", ".join(missing)
            + "。请先同步仓库的 compose.yaml，再运行本脚本；不修改宿主机设置。"
        )


def blocked_settings():
    changes = {}
    for key, blocked, desired in (
        ("kernel.unprivileged_userns_clone", "0", "1"),
        ("user.max_user_namespaces", "0", "16384"),
        ("kernel.apparmor_restrict_unprivileged_userns", "1", "0"),
    ):
        result = run(["sysctl", "-n", key], capture_output=True, text=True)
        if result.returncode == 0:
            value = result.stdout.strip()
            print(f"{key} = {value}", flush=True)
            if value == blocked:
                changes[key] = (value, desired)
    return changes


def persist(changes):
    previous = POLICY.read_text() if POLICY.exists() else ""
    # Preserve earlier repairs when only a newly changed host setting is blocked.
    lines = [line for line in previous.splitlines()
             if line.split("=", 1)[0].strip() not in changes]
    if not lines:
        lines.append("# OhMyPaper AI sandbox: verified on this Docker host.")
    lines.extend(f"{key} = {desired}" for key, (_, desired) in changes.items())
    with tempfile.NamedTemporaryFile(mode="w", dir=POLICY.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write("\n".join(lines) + "\n")
            output.flush()
            temporary.chmod(0o644)
            temporary.replace(POLICY)
        finally:
            temporary.unlink(missing_ok=True)


def repair_host():
    changes = blocked_settings()
    if not changes:
        raise RuntimeError(
            "未发现可修复的 sysctl 禁用项。请检查 Docker 的 seccomp、AppArmor、"
            "systempaths 配置、宿主机内核及命名空间配额；详见 docs/deployment.zh-CN.md。"
        )
    applied = []
    try:
        for key, (_, desired) in changes.items():
            print(f"修复宿主机设置：{key}={desired}", flush=True)
            run(["sysctl", "-w", f"{key}={desired}"], check=True)
            applied.append(key)
        # A sysctl change alone is insufficient evidence: test the actual image
        # with the same user, mounts and security options as the deployed worker.
        run(PROBE, check=True)
        persist(changes)
    except BaseException:
        for key in reversed(applied):
            result = run(["sysctl", "-w", f"{key}={changes[key][0]}"])
            if result.returncode:
                print(f"无法回滚 {key}，请人工恢复为 {changes[key][0]}。", file=sys.stderr)
        raise
    print(f"宿主机配置已验证并保存到 {POLICY}。", flush=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("请在 Docker 宿主机运行 sudo python3 deploy/repair-sandbox.py。")
    validate_compose()
    print("按当前 Compose 配置验收沙箱，暂不替换运行中的 Worker。", flush=True)
    if run(PROBE).returncode:
        repair_host()
    print("沙箱验收通过，重新创建 Worker 以应用 Docker 安全配置。", flush=True)
    run(COMPOSE + ["up", "-d", "--no-deps", "--no-build", "--force-recreate", "ai-worker"], check=True)
    run(COMPOSE + [
        "exec", "-T", "ai-worker", "node", "--conditions=react-server", "sandbox-check.mjs",
    ], check=True)
    print("AI Worker 沙箱已恢复。现在可在界面重试失败的任务。", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"沙箱修复失败：{error}", file=sys.stderr)
        sys.exit(1)

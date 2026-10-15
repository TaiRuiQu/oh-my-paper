"""Validate one complete OCI release index and emit digest-pinned Compose JSON."""

import json
import re
import sys


def release_config(manifest):
    annotations = manifest.get("annotations", {})
    prefix = "io.oh-my-paper.release"
    if annotations.get(f"{prefix}.version") != "1" or not re.fullmatch(
        r"[a-f0-9]{40}", annotations.get("org.opencontainers.image.revision", "")
    ):
        raise ValueError("Missing or invalid complete release manifest")
    services = {}
    for target, suffix in (("web", ""), ("migrate", "-migrate"), ("ai-worker", "-ai-worker")):
        digest = annotations.get(f"{prefix}.{target}", "")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            raise ValueError(f"Invalid {target} release digest")
        services[target] = {"image": f"ghcr.io/tairuiqu/oh-my-paper{suffix}@{digest}"}
    return {"services": services}


if __name__ == "__main__":
    json.dump(release_config(json.load(sys.stdin)), sys.stdout, indent=2)
    print()

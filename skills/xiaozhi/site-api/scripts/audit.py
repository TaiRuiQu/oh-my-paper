#!/usr/bin/env python3
"""Check API documentation coverage and source drift; never imports application code.

Run --write only after reviewing and updating the affected reference documents.
The default root is derived from this script, so the command is independent of cwd.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import subprocess

METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
GROUPS = {
    "contracts": "src/contracts",
    "platform-services": "src/server/platform",
    "auth-services": "src/server/auth",
    "http-services": "src/server/http",
    "xiaozhi-runtime": "src/server/xiaozhi",
    "ai-runtime": "src/server/ai",
    "lib": "src/lib",
    "config": "src/server/config",
}
DOC_METHOD = re.compile(r"^### (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (/api/\S+)\s*$", re.M)


def sha(content):
    return hashlib.sha256(content).hexdigest()


def source_bytes(path):
    # Git checkouts may use CRLF on Windows; hash the same UTF-8/LF source everywhere.
    return path.read_text(encoding="utf-8").encode("utf-8")


def methods(source):
    # Named function/const declarations and explicit re-exports. Unsupported
    # export syntax cannot silently turn an existing route into an empty entry.
    names = set(re.findall(r"\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b", source))
    for block in re.findall(r"\bexport\s*\{([^}]+)\}", source, re.S):
        for item in block.split(","):
            name = item.strip().split(" as ")[-1].strip()
            if name in METHODS:
                names.add(name)
    return sorted(names)


def route_path(path, app):
    parts = path.relative_to(app).parts[:-1]
    parts = [p for p in parts if not (p.startswith("(") and p.endswith(")")) and not p.startswith("@")]
    return "/" + "/".join(re.sub(r"\[([^]]+)\]", r"{\1}", p) for p in parts)


def snapshot(root, skill):
    docs = {}
    errors = []
    for reference in sorted((skill / "references").glob("*.md")):
        for method, path in DOC_METHOD.findall(reference.read_text(encoding="utf-8")):
            key = (path, method)
            if key in docs:
                errors.append(f"Duplicate documentation: {method} {path}")
            docs[key] = reference.relative_to(skill).as_posix()
    entries = []
    discovered = set()
    app = root / "src/app"
    for route in sorted(app.rglob("route.*")):
        if route.suffix not in {".ts", ".js", ".tsx", ".jsx", ".mjs"}:
            continue
        source = source_bytes(route)
        exported = methods(source.decode())
        if not exported:
            errors.append(f"No statically recognized HTTP method: {route.relative_to(root)}")
        path = route_path(route, app)
        references = {}
        for method in exported:
            key = (path, method)
            discovered.add(key)
            if key not in docs:
                errors.append(f"Missing API documentation: {method} {path}")
            else:
                references[method] = docs[key]
        implicit = sorted(({"OPTIONS"} if "OPTIONS" not in exported else set()) | ({"HEAD"} if "GET" in exported and "HEAD" not in exported else set()))
        entries.append({"path": path, "methods": exported, "implicitMethods": implicit,
                        "source": route.relative_to(root).as_posix(), "sha256": sha(source),
                        "references": references})
    for path, method in sorted(set(docs) - discovered):
        errors.append(f"Documented API no longer exported: {method} {path}")
    source_groups = {}
    for name, directory in GROUPS.items():
        paths = sorted(p for p in (root / directory).rglob("*") if p.is_file() and p.suffix in {".ts", ".tsx", ".js", ".mjs"})
        digest = hashlib.sha256()
        for path in paths:
            digest.update(path.relative_to(root).as_posix().encode() + b"\0" + source_bytes(path) + b"\0")
        source_groups[name] = {"directory": directory, "files": len(paths), "sha256": digest.hexdigest()}
    extra = {}
    for name in ("prisma/schema.prisma", "src/server/errors.ts", "src/server/logger.ts", "src/lib/ai-progress-codec.ts", "scripts/scanner-bridge/bridge.py"):
        path = root / name
        if path.is_file():
            extra[name] = sha(source_bytes(path))
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    dependencies = {name: package.get("dependencies", {}).get(name) for name in ("next", "better-auth", "zod")}
    for path in skill.rglob("*"):
        if path.is_file() and path.suffix in {".md", ".json", ".txt", ".csv"} and len(path.read_text(encoding="utf-8")) > 40000:
            errors.append(f"Skill resource exceeds runtime 40000-character limit: {path.relative_to(skill)}")
    delegated = []
    auth_index = (skill / "references/auth.md").read_text(encoding="utf-8")
    for file in sorted((skill / "references").glob("auth-schemas-*.json")):
        for endpoint in json.loads(file.read_text(encoding="utf-8"))["endpoints"]:
            if endpoint["path"] not in auth_index:
                errors.append(f"Missing delegated auth index: {endpoint['path']}")
            delegated.append({"path": endpoint["path"], "methods": endpoint["methods"], "reference": file.relative_to(skill).as_posix()})
    return {"formatVersion": 1, "delegatedAuth": delegated, "routeCount": len(entries), "methodCount": sum(len(e["methods"]) for e in entries), "implicitMethodCount": sum(len(e["implicitMethods"]) for e in entries),
            "routes": entries, "sourceGroups": source_groups, "additionalSourceHashes": extra,
            "dependencyVersions": dependencies}, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    parser.add_argument("--root", type=Path, help="Repository root (for isolated audit tests)")
    args = parser.parse_args()
    root = args.root.resolve() if args.root else Path(__file__).resolve().parents[4]
    skill = root / "skills/xiaozhi/site-api"
    manifest = skill / "references/routes.json"
    current, errors = snapshot(root, skill)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    auth_check = subprocess.run(["node", str(skill / "scripts/auth-catalog.mjs"), "--check"], capture_output=True, text=True)
    if auth_check.returncode:
        print(auth_check.stdout + auth_check.stderr, file=sys.stderr)
        return 1
    encoded = json.dumps(current, ensure_ascii=False, indent=2) + "\n"
    if len(encoded) > 40000:
        print("Inventory exceeds runtime resource limit; split before writing.", file=sys.stderr)
        return 1
    if args.write:
        # Format exactly as the repository does without modifying files in check mode.
        formatting = subprocess.run(
            ["node", "--input-type=module", "-e",
             'import {format,resolveConfig} from "prettier"; let input=""; for await (const chunk of process.stdin) input+=chunk; const filepath=process.argv[1]; process.stdout.write(await format(input,{...(await resolveConfig(filepath)),filepath}));',
             str(manifest)],
            input=encoded, capture_output=True, text=True, cwd=root,
        )
        if formatting.returncode:
            print(formatting.stderr, file=sys.stderr)
            return 1
        if len(formatting.stdout) > 40000:
            print("Formatted inventory exceeds runtime resource limit.", file=sys.stderr)
            return 1
        manifest.write_text(formatting.stdout, encoding="utf-8", newline="\n")
        print(f"Updated {manifest.relative_to(root)} after documentation review.")
    else:
        try:
            old = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
        except json.JSONDecodeError:
            old = {}
        if old != current:
            print("API Skill is stale. Review API references, then run audit.py --write.", file=sys.stderr)
            for group, fingerprint in current["sourceGroups"].items():
                if old.get("sourceGroups", {}).get(group) != fingerprint:
                    print(f"Changed source group: {group}", file=sys.stderr)
            if old.get("routes") != current["routes"]:
                print("Changed route exports or implementation.", file=sys.stderr)
            return 1
        print(f"API Skill verified: {current['routeCount']} route files, {current['methodCount']} explicit HTTP methods; documentation and source fingerprints match.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

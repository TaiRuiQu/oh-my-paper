"""Inventory the exact npm lockfile and Linux/Python resolution, without installing packages.

Run after pnpm install. Network access to npm/PyPI is required. Raw downloads and
the pip resolution stay under ignored .local/open-source-audit/.
"""

import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".local/open-source-audit"
OUTPUT = ROOT / "legal"
CACHE.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(exist_ok=True)


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise


def json_write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def is_notice(name):
    return bool(re.match(r"^(licen[cs]e|copying|notice|copyright|authors)([._-]|$)", Path(name).name, re.I))


def npm_package(key):
    name, version = key.rsplit("@", 1)
    cache = CACHE / (hashlib.sha256(key.encode()).hexdigest() + ".json")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    url = "https://registry.npmjs.org/" + urllib.parse.quote(name, safe="@/") + "/" + version
    metadata = json.loads(get(url))
    dist = metadata["dist"]
    # Read LICENSE/NOTICE from the published artifact; do not execute package code.
    archive = get(dist["tarball"])
    integrity = dist["integrity"].split()[0]
    algorithm, encoded = integrity.split("-", 1)
    import base64
    assert base64.b64encode(hashlib.new(algorithm, archive).digest()).decode() == encoded, key
    texts = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.isfile() and is_notice(member.name) and member.size < 2_000_000:
                texts[member.name] = tar.extractfile(member).read().decode("utf-8", errors="replace")
    result = {
        "name": name, "version": version, "license": metadata.get("license", metadata.get("licenses")),
        "metadata": url, "artifact": dist["tarball"], "integrity": dist["integrity"],
        "repository": metadata.get("repository"), "gitHead": metadata.get("gitHead"),
        "notices": texts,
    }
    json_write(cache, result)
    return result


def main():
    lock_json = subprocess.check_output(
        ["node", "-e", "const fs=require('fs'),y=require('yaml');console.log(JSON.stringify(Object.keys(y.parse(fs.readFileSync('pnpm-lock.yaml','utf8')).packages)))"],
        cwd=ROOT, text=True,
    )
    keys = json.loads(lock_json)
    print(f"Checking {len(keys)} npm packages (including optional platforms).", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        packages = list(executor.map(npm_package, keys))
    notices = ["Third-party npm license and notice texts\n\nGenerated from integrity-verified published package archives.\nOriginal licenses continue to apply; the root MIT license does not replace them.\n"]
    missing = []
    for package in packages:
        notices.append("\n" + "=" * 78 + "\n" + package["name"] + "@" + package["version"] + "\nLicense: " + str(package["license"]) + "\nArtifact: " + package["artifact"] + "\n")
        texts = package.pop("notices")
        if not texts:
            missing.append(package["name"] + "@" + package["version"])
            notices.append("No separate license file in the npm archive; see package metadata and upstream repository.\n")
        for filename, contents in sorted(texts.items()):
            notices.append("\n--- " + filename + " ---\n" + contents + "\n")
    json_write(OUTPUT / "npm-packages.json", {
        "lockfileSha256": hashlib.sha256((ROOT / "pnpm-lock.yaml").read_text(encoding="utf-8").encode()).hexdigest(),
        "scope": "Every package entry in pnpm-lock.yaml, including development and optional platform packages",
        "packages": packages,
        "archivesWithoutLicenseFile": missing,
    })
    (OUTPUT / "npm-NOTICES.txt").write_text("".join(notices), encoding="utf-8")
    resolution = CACHE / "python-resolution.json"
    if resolution.exists():
        installs = json.loads(resolution.read_text(encoding="utf-8"))["install"]
        result = []
        python_notices = ["Third-party Python wheel notices\n\nThese include licenses of bundled native libraries.\n"]
        for item in installs:
            m = item["metadata"]
            name, version = m["name"], m["version"]
            metadata_url = f"https://pypi.org/pypi/{name}/{version}/json"
            metadata = json.loads(get(metadata_url))["info"]
            download = item["download_info"]
            wheel_path = CACHE / Path(urllib.parse.urlparse(download["url"]).path).name
            if not wheel_path.exists():
                wheel_path.write_bytes(get(download["url"]))
            wheel = wheel_path.read_bytes()
            assert hashlib.sha256(wheel).hexdigest() == download["archive_info"]["hashes"]["sha256"], name
            python_notices.append(f"\n{'=' * 78}\n{name}=={version}\nArtifact: {download['url']}\n")
            with zipfile.ZipFile(io.BytesIO(wheel)) as archive:
                for filename in sorted(archive.namelist()):
                    if not filename.endswith("/") and (is_notice(filename) or ".dist-info/licenses/" in filename):
                        python_notices.append(f"\n--- {filename} ---\n" + archive.read(filename).decode("utf-8", errors="replace") + "\n")
            result.append({
                "name": name, "version": version,
                "license": metadata.get("license_expression") or metadata.get("license"),
                "metadata": metadata_url,
                "classifiers": [c for c in m.get("classifier", []) if c.startswith("License")],
                "projectUrls": m.get("project_url", []),
                "artifact": item["download_info"], "direct": item["requested"],
            })
        json_write(OUTPUT / "python-packages.json", {"target": "CPython 3.11 Linux x86_64 (Debian bookworm containers)", "packages": result})
        (OUTPUT / "python-NOTICES.txt").write_text("".join(python_notices), encoding="utf-8")
    print(f"Wrote {len(packages)} npm records; {len(missing)} archives have no separate license file.", flush=True)


if __name__ == "__main__":
    main()

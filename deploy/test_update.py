import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("release", DEPLOY / "resolve-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
PREFIX = "io.oh-my-paper.release"
MANIFEST = {
    "annotations": {
        f"{PREFIX}.version": "1",
        "org.opencontainers.image.revision": "a" * 40,
        **{f"{PREFIX}.{target}": "sha256:" + value * 64
           for target, value in (("web", "1"), ("migrate", "2"), ("ai-worker", "3"))},
    }
}

FAKE_DOCKER = r'''
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
with open("calls.jsonl", "a") as log:
    log.write(json.dumps(args) + "\n")
if "--environment" in args:
    print("APP_VERSION=" + os.environ.get("TEST_VERSION", "latest"))
elif args[:3] == ["buildx", "imagetools", "inspect"]:
    if os.environ.get("TEST_FAIL") == "inspect":
        sys.exit(1)
    print(Path("manifest.json").read_text())
    # A new latest becomes visible immediately after this single read.
    Path("manifest.json").write_text('{"annotations": {}}')
elif "pull" in args:
    config = json.loads(Path(args[args.index("-f", 3) + 1]).read_text())
    Path("pulled.json").write_text(json.dumps(config))
    if os.environ.get("TEST_FAIL") == "pull":
        sys.exit(1)
elif "up" in args:
    Path("started.json").write_text(Path("deploy/.release.json").read_text())
    if os.environ.get("TEST_FAIL") == "up":
        sys.exit(1)
'''

COMPOSE = (
    [os.environ["PAPER_COMPOSE_TEST_BINARY"]]
    if os.environ.get("PAPER_COMPOSE_TEST_BINARY")
    else [shutil.which("docker"), "compose"] if shutil.which("docker") else None
)


@unittest.skipUnless(COMPOSE, "Docker Compose is not installed")
class ComposeConfigTests(unittest.TestCase):
    def test_saved_release_supplies_digest_images_and_removes_source_builds(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "deploy").mkdir()
            for name in ("compose.yaml", "compose.release.yaml"):
                shutil.copy(DEPLOY.parent / name, project / name)
            (project / ".env").write_text(
                "APP_DOMAIN=paper.example.com\nPOSTGRES_PASSWORD=test\n"
                "DEPLOY_DATABASE_URL=postgresql://paper:test@db/paper\n"
                "QDRANT_API_KEY=test\nAPP_VERSION=sha-" + "a" * 40 + "\n"
            )
            pinned = release.release_config(MANIFEST)
            (project / "deploy/.release.json").write_text(json.dumps(pinned))
            environment = {key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ}
            base = COMPOSE + ["-f", "compose.yaml"]
            config_env = subprocess.check_output(
                base + ["config", "--environment"], cwd=project, env=environment, text=True,
            )
            self.assertIn("APP_VERSION=sha-" + "a" * 40, config_env)
            for overlay in ("compose.release.yaml", "deploy/.release.json"):
                config = json.loads(subprocess.check_output(
                    base + ["-f", overlay, "config", "--format", "json"],
                    cwd=project, env=environment, text=True,
                ))
                for target, service in pinned["services"].items():
                    self.assertEqual(config["services"][target]["image"], service["image"])
                    if overlay == "compose.release.yaml":
                        self.assertNotIn("build", config["services"][target])


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "deploy").mkdir()
        (self.root / "bin").mkdir()
        for name in ("update.sh", "resolve-release.py"):
            shutil.copy(DEPLOY / name, self.root / "deploy" / name)
        docker = self.root / "bin" / "docker"
        docker.write_text(f"#!{sys.executable}\n" + FAKE_DOCKER)
        docker.chmod(0o755)
        (self.root / "manifest.json").write_text(json.dumps(MANIFEST))
        self.lock = self.root / "deploy" / ".release.json"
        self.lock.write_text('{"previous": true}')

    def run_update(self, **overrides):
        return subprocess.run(
            ["bash", "deploy/update.sh"], cwd=self.root,
            env={**os.environ, "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}", **overrides},
            capture_output=True, text=True,
        )

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]

    def test_latest_is_read_once_and_all_images_are_pinned_before_start(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads((self.root / "started.json").read_text())
        self.assertEqual(config, json.loads((self.root / "pulled.json").read_text()))
        self.assertEqual(config, release.release_config(MANIFEST))
        self.assertEqual(sum("inspect" in call for call in self.calls()), 1)
        self.assertTrue(any(call[:2] == ["image", "prune"] for call in self.calls()))
        self.assertEqual(list((self.root / "deploy").glob(".release.*.json")), [])

    def test_resolution_or_pull_failure_preserves_previous_selection_and_running_services(self):
        for failure in ("inspect", "pull", "invalid"):
            with self.subTest(failure=failure):
                (self.root / "manifest.json").write_text(json.dumps(MANIFEST) if failure != "invalid" else "{}")
                result = self.run_update(TEST_FAIL=failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.lock.read_text(), '{"previous": true}')
                self.assertFalse((self.root / "started.json").exists())
                self.assertFalse(any(call[:2] == ["image", "prune"] for call in self.calls()))

    def test_failed_start_skips_image_cleanup(self):
        result = self.run_update(TEST_FAIL="up")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ["image", "prune"] for call in self.calls()))

    def test_explicit_release_uses_the_same_complete_manifest_protocol(self):
        result = self.run_update(TEST_VERSION="sha-" + "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        inspect = next(call for call in self.calls() if "inspect" in call)
        self.assertEqual(inspect[3], "ghcr.io/tairuiqu/oh-my-paper:sha-" + "a" * 40)

    def test_incomplete_release_is_rejected(self):
        for missing in ("version", "web", "migrate", "ai-worker"):
            manifest = json.loads(json.dumps(MANIFEST))
            del manifest["annotations"][f"{PREFIX}.{missing}"]
            with self.assertRaises(ValueError):
                release.release_config(manifest)


if __name__ == "__main__":
    unittest.main()

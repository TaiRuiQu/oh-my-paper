import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "repair_sandbox", Path(__file__).with_name("repair-sandbox.py"),
)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class SandboxRepairTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.policy = Path(directory.name) / "sandbox.conf"
        self.values = {
            "kernel.unprivileged_userns_clone": "0",
            "user.max_user_namespaces": "0",
            "kernel.apparmor_restrict_unprivileged_userns": "1",
        }
        self.original = dict(self.values)
        self.probes = [1, 0]
        self.calls = []
        self.config_exit = 0
        self.worker_config = {
            "security_opt": [option.replace("=", ":", 1) for option in repair.SECURITY_OPTIONS
                             if not option.startswith("systempaths=")] + ["systempaths=unconfined"],
            "cap_drop": ["ALL"],
        }
        self.failure = None
        for target, value in (("POLICY", self.policy), ("run", self.run_command)):
            patcher = patch.object(repair, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(repair.os, "geteuid", return_value=0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_command(self, args, **kwargs):
        self.calls.append(args)
        output = ""
        code = 0
        if args == repair.PROBE:
            code = self.probes.pop(0)
        elif args == repair.COMPOSE + ["config", "--format", "json"]:
            code = self.config_exit
            output = json.dumps({"services": {"ai-worker": self.worker_config}})
        elif args[:2] == ["sysctl", "-n"]:
            output = self.values.get(args[2], "")
            code = 0 if output else 1
        elif args[:2] == ["sysctl", "-w"]:
            key, value = args[2].split("=", 1)
            if args[2] == self.failure:
                code = 1
            else:
                self.values[key] = value
        if code and kwargs.get("check"):
            raise subprocess.CalledProcessError(code, args)
        return subprocess.CompletedProcess(args, code, stdout=output, stderr="")

    def test_recreates_stale_worker_without_changing_host_when_compose_probe_passes(self):
        self.probes = [0]
        repair.main()
        self.assertEqual(self.values, self.original)
        self.assertFalse(any(call[0] == "sysctl" for call in self.calls))
        self.assertFalse(self.policy.exists())
        self.assertIn("--force-recreate", self.calls[-2])
        self.assertIn("--no-deps", self.calls[-2])
        self.assertEqual(self.calls[-1][len(repair.COMPOSE):3 + len(repair.COMPOSE)],
                         ["exec", "-T", "ai-worker"])

    def test_repairs_blocked_settings_then_verifies_before_persisting_and_recreating(self):
        repair.main()
        self.assertEqual(self.values, {
            "kernel.unprivileged_userns_clone": "1",
            "user.max_user_namespaces": "16384",
            "kernel.apparmor_restrict_unprivileged_userns": "0",
        })
        policy = self.policy.read_text()
        for key, value in self.values.items():
            self.assertIn(f"{key} = {value}", policy)
        probes = [i for i, call in enumerate(self.calls) if call == repair.PROBE]
        recreate = next(i for i, call in enumerate(self.calls) if "--force-recreate" in call)
        self.assertEqual(len(probes), 2)
        self.assertLess(probes[-1], recreate)

    def test_failed_verification_rolls_back_and_leaves_worker_and_persistent_policy_untouched(self):
        self.probes = [1, 1]
        self.policy.write_text("# existing policy\n")
        with self.assertRaises(subprocess.CalledProcessError):
            repair.main()
        self.assertEqual(self.values, self.original)
        self.assertEqual(self.policy.read_text(), "# existing policy\n")
        self.assertFalse(any("--force-recreate" in call for call in self.calls))

    def test_partial_sysctl_failure_rolls_back_preceding_changes(self):
        self.failure = "user.max_user_namespaces=16384"
        with self.assertRaises(subprocess.CalledProcessError):
            repair.main()
        self.assertEqual(self.values, self.original)
        self.assertFalse(self.policy.exists())
        self.assertFalse(any("--force-recreate" in call for call in self.calls))

    def test_missing_kernel_keys_are_skipped_and_previous_repairs_are_preserved(self):
        del self.values["kernel.apparmor_restrict_unprivileged_userns"]
        self.values["kernel.unprivileged_userns_clone"] = "1"
        self.policy.write_text("kernel.unprivileged_userns_clone = 1\n")
        repair.main()
        self.assertEqual(self.policy.read_text(),
                         "kernel.unprivileged_userns_clone = 1\nuser.max_user_namespaces = 16384\n")
        writes = [call[2] for call in self.calls if call[:2] == ["sysctl", "-w"]]
        self.assertEqual(writes, ["user.max_user_namespaces=16384"])

    def test_invalid_compose_configuration_never_changes_host(self):
        self.config_exit = 1
        with self.assertRaises(subprocess.CalledProcessError):
            repair.main()
        self.assertEqual(len(self.calls), 1)

    def test_missing_docker_security_options_never_trigger_host_policy_changes(self):
        self.worker_config = {}
        with self.assertRaisesRegex(RuntimeError, "缺少必要安全配置"):
            repair.main()
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.policy.exists())

    def test_unrelated_failure_does_not_change_healthy_sysctls(self):
        self.values = {"kernel.unprivileged_userns_clone": "1", "user.max_user_namespaces": "1000"}
        with self.assertRaisesRegex(RuntimeError, "未发现可修复"):
            repair.main()
        self.assertFalse(any(call[:2] == ["sysctl", "-w"] for call in self.calls))
        self.assertFalse(any("--force-recreate" in call for call in self.calls))


if __name__ == "__main__":
    unittest.main()

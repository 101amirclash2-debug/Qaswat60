"""Unit tests for the bridge's server-side command policy."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))

import policy  # noqa: E402


class AssessTest(unittest.TestCase):
    def test_blocks_catastrophic_commands(self):
        commands = [
            "rm -rf /",
            "rm -rf ~",
            "sudo rm -rf /data",
            "rm -rf /sdcard",
            "rm -fr /system",
            "mkfs.ext4 /dev/block/mmcblk0p1",
            "dd if=/dev/zero of=/dev/block/sda",
            "shutdown -h now",
            ":(){ :|:& };:",
            "pm uninstall com.android.chrome",
            "pm clear com.whatsapp",
            "settings put secure adb_enabled 1",
            "echo x > /system/build.prop",
            "iptables -F",
            "pkill -f qaswara_bridge.py",
        ]
        for command in commands:
            verdict = policy.assess(command)
            self.assertFalse(verdict.allowed, f"should block: {command}")
            self.assertTrue(verdict.reasons, "a reason is required for the UI")

    def test_allows_normal_work(self):
        commands = [
            "ls -la",
            "python3 script.py",
            "echo hello > notes.txt",
            "cat data.csv | head -5",
            "rm -rf build/",
            "git status",
            "pip install requests",
            "termux-battery-status",
        ]
        for command in commands:
            self.assertTrue(policy.assess(command).allowed, f"should allow: {command}")

    def test_allow_dangerous_flag_bypasses_denylist(self):
        self.assertTrue(policy.assess("rm -rf /", allow_dangerous=True).allowed)

    def test_rejects_empty_and_oversized_code(self):
        with self.assertRaises(policy.PolicyError):
            policy.assess("   ")
        with self.assertRaises(policy.PolicyError):
            policy.assess("a" * (policy.MAX_CODE_BYTES + 10))
        with self.assertRaises(policy.PolicyError):
            policy.assess(None)  # type: ignore[arg-type]

    def test_reasons_are_unique(self):
        verdict = policy.assess("sudo rm -rf /")
        self.assertEqual(len(verdict.reasons), len(set(verdict.reasons)))


class HelpersTest(unittest.TestCase):
    def test_clamp_timeout(self):
        self.assertEqual(policy.clamp_timeout(None), policy.DEFAULT_TIMEOUT)
        self.assertEqual(policy.clamp_timeout("30"), 30)
        self.assertEqual(policy.clamp_timeout(0), policy.DEFAULT_TIMEOUT)
        self.assertEqual(policy.clamp_timeout(-5), policy.DEFAULT_TIMEOUT)
        self.assertEqual(policy.clamp_timeout(10_000), policy.MAX_TIMEOUT)
        self.assertEqual(policy.clamp_timeout("abc"), policy.DEFAULT_TIMEOUT)

    def test_validate_lang(self):
        self.assertEqual(policy.validate_lang("BASH"), "bash")
        self.assertEqual(policy.validate_lang(None), "bash")
        with self.assertRaises(policy.PolicyError):
            policy.validate_lang("ruby")

    def test_scrub_env_removes_secret_like_variables(self):
        env = {
            "PATH": "/usr/bin",
            "OPENAI_API_KEY": "sk-secret",
            "GITHUB_TOKEN": "ghp_x",
            "DB_PASSWORD": "hunter2",
            "HOME": "/home/user",
        }
        cleaned = policy.scrub_env(env)
        self.assertEqual(cleaned, {"PATH": "/usr/bin", "HOME": "/home/user"})


class SafeJoinTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        (self.root / "sub").mkdir()
        (self.root / "sub" / "file.txt").write_text("x")

    def tearDown(self):
        self.tmp.cleanup()

    def test_resolves_inside_root(self):
        self.assertEqual(policy.safe_join(str(self.root), "sub/file.txt"), str(self.root / "sub" / "file.txt"))
        self.assertEqual(policy.safe_join(str(self.root), "."), str(self.root))

    def test_rejects_escapes(self):
        for bad in ("../etc/passwd", "sub/../../etc/passwd", "/etc/passwd", "~/secrets"):
            with self.assertRaises(policy.PolicyError, msg=bad):
                policy.safe_join(str(self.root), bad)

    def test_rejects_symlink_escape(self):
        link = self.root / "escape"
        try:
            os.symlink("/etc", link)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        with self.assertRaises(policy.PolicyError):
            policy.safe_join(str(self.root), "escape/passwd")


if __name__ == "__main__":
    unittest.main()

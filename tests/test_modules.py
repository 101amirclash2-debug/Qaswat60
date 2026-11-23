"""QASWARA engine tests: office, media, apk builder, Artemis audit, policy."""

import os
import sys
import tempfile
import unittest
import wave
import zipfile
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent.parent / "bridge"
sys.path.insert(0, str(BRIDGE_DIR))

import appbuilder  # noqa: E402
import audit as artemis  # noqa: E402
import media  # noqa: E402
import office  # noqa: E402
import policy  # noqa: E402


class OfficeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_xlsx_roundtrip_keeps_arabic_rows(self):
        target = self.root / "report.xlsx"
        result = office.create("xlsx", str(target), {"title": "تقرير", "rows": [["الاسم", "المبلغ"], ["أحمد", 120]]})
        self.assertTrue(result["ok"])
        self.assertTrue(target.exists())
        extracted = office.extract(str(target))
        self.assertEqual(extracted["tool"], "ooxml")
        self.assertIn("أحمد", extracted["text"])
        self.assertIn("120", extracted["text"])

    def test_docx_roundtrip_and_headings(self):
        target = self.root / "plan.docx"
        office.create(
            "docx",
            str(target),
            {"title": "خطة", "sections": [{"heading": "المقدمة", "body": ["نص عربي", "سطر ثانٍ"]}]},
        )
        text = office.extract(str(target))["text"]
        self.assertIn("المقدمة", text)
        self.assertIn("نص عربي", text)

    def test_csv_html_rtf_md_and_zip(self):
        csv_path = self.root / "data.csv"
        office.create("csv", str(csv_path), {"rows": [["أ", "ب"], ["1", "2"]]})
        self.assertIn("أ", csv_path.read_text(encoding="utf-8-sig"))

        html_path = self.root / "page.html"
        office.create("html", str(html_path), {"title": "صفحة", "sections": [{"heading": "ع", "body": ["نص"]}]})
        self.assertIn("lang=\"ar\"", html_path.read_text(encoding="utf-8"))

        rtf_path = self.root / "doc.rtf"
        office.create("rtf", str(rtf_path), {"title": "عنوان", "sections": [{"heading": "ب", "body": ["ج"]}]})
        self.assertTrue(rtf_path.read_text(encoding="utf-8").startswith("{\\rtf"))

        md_path = self.root / "note.md"
        office.create("md", str(md_path), {"title": "ملاحظة", "sections": [{"heading": "قسم", "body": ["محتوى"]}]})
        self.assertIn("# ملاحظة", md_path.read_text(encoding="utf-8"))

        zip_path = self.root / "files.zip"
        office.create("zip", str(zip_path), {"files": {"a.txt": "مرحبا", "b.txt": "ثانٍ"}})
        with zipfile.ZipFile(zip_path) as archive:
            self.assertEqual(sorted(archive.namelist()), ["a.txt", "b.txt"])

    def test_unknown_kind_is_rejected(self):
        with self.assertRaises(office.OfficeError):
            office.create("exe", str(self.root / "x.exe"), {})

    def test_extract_missing_file_reports_cleanly(self):
        with self.assertRaises(office.OfficeError):
            office.extract(str(self.root / "ghost.pdf"))


class MediaTest(unittest.TestCase):
    def test_instrumental_wav_is_real_pcm(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tune.wav"
            result = media.synth_instrumental(str(path), seconds=3, bpm=100)
            self.assertTrue(path.exists())
            self.assertGreater(result["bytes"], 1000)
            with wave.open(str(path), "rb") as handle:
                self.assertEqual(handle.getnchannels(), 1)
                self.assertGreater(handle.getnframes(), 1000)

    def test_song_without_ffmpeg_still_produces_wav_and_a_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = media.make_song(
                title="نشيد",
                lyrics="قسورة يا قسورة\nبالعزم نبنى",
                out_dir=tmp,
                seconds=3,
                with_vocals=False,
            )
            self.assertTrue(result["ok"])
            self.assertTrue(Path(result["files"][0]).exists())
            self.assertIn(result["format"], {"wav", "mp3"})

    def test_probe_reports_available_tools(self):
        info = media.probe()
        self.assertEqual(
            sorted(info), ["espeak", "ffmpeg", "ffprobe", "sox"]
        )


class ApkTest(unittest.TestCase):
    def test_bundle_zip_always_builds(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = appbuilder.write_bundle(
                out_dir=tmp,
                name="Demo",
                files={"index.html": "<h1>مرحبا</h1>", "app.js": "console.log(1)"},
            )
            self.assertTrue(result["ok"])
            self.assertTrue(Path(result["path"]).exists())
            with zipfile.ZipFile(result["path"]) as archive:
                self.assertIn("index.html", archive.namelist())

    def test_toolchain_report_is_honest(self):
        report = appbuilder.toolchain()
        self.assertIn("javac", report)
        self.assertIsInstance(appbuilder.missing_tools(), list)

    def test_apk_build_without_toolchain_explains_what_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = appbuilder.build_webview_apk(tmp, {"index.html": "<h1>x</h1>"})
            if appbuilder.missing_tools():
                self.assertFalse(result["ok"])
                self.assertIn(result.get("code") or "missing_toolchain", {"missing_toolchain", "build_failed"})
                self.assertTrue(result.get("bundle"))
            else:  # a machine with a full SDK should actually produce an APK
                self.assertTrue(result["ok"])
                self.assertTrue(Path(result["path"]).exists())


class ArtemisTest(unittest.TestCase):
    def test_clean_code_scores_full_marks(self):
        result = artemis.audit_code("def add(a, b):\n    return a + b\n", "python")
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["findings"], [])

    def test_secrets_and_eval_are_caught(self):
        code = 'const key = "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";\neval(userInput);\n'
        result = artemis.audit_code(code, "javascript")
        self.assertFalse(result["ok"])
        self.assertLess(result["score"], 100)
        rules = " ".join(finding["rule"] for finding in result["findings"])
        self.assertIn("eval", rules)

    def test_syntax_error_is_reported_with_a_line(self):
        result = artemis.audit_code("def broken(:\n    pass\n", "python")
        self.assertLess(result["score"], 100)
        self.assertTrue(any(finding["severity"] in {"critical", "high"} for finding in result["findings"]))


class PolicyTest(unittest.TestCase):
    def test_install_allowlist(self):
        self.assertEqual(policy.validate_install("pkg", "ffmpeg"), "ffmpeg")
        with self.assertRaises(policy.PolicyError):
            policy.validate_install("pkg", "evilpkg")
        with self.assertRaises(policy.PolicyError):
            policy.validate_install("pip", "requests; rm -rf /")

    def test_timeouts_and_languages_are_clamped(self):
        self.assertEqual(policy.clamp_timeout(99999), 600)
        self.assertEqual(policy.clamp_timeout(0), 60)
        self.assertEqual(policy.validate_lang("python3"), "python3")
        with self.assertRaises(policy.PolicyError):
            policy.validate_lang("perl")

    def test_phone_numbers_are_validated(self):
        self.assertEqual(policy.validate_phone_number("+967 111 222 333"), "+967111222333")
        with self.assertRaises(policy.PolicyError):
            policy.validate_phone_number("123; reboot")

    def test_safe_join_blocks_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            inside = policy.safe_join(tmp, "a/b.txt")
            self.assertTrue(inside.startswith(os.path.realpath(tmp)))
            with self.assertRaises(policy.PolicyError):
                policy.safe_join(tmp, "../escape.txt")

    def test_critical_commands_are_denied(self):
        for command in ("rm -rf /", "mkfs.ext4 /dev/block/sda", "reboot", "pkill -f qaswara_bridge.py"):
            verdict = policy.assess(command)
            self.assertFalse(verdict.allowed, command)

    def test_offline_mode_blocks_network_commands(self):
        self.assertFalse(policy.assess_network("pip install requests").allowed)
        self.assertTrue(policy.assess_network("ls -la").allowed)


if __name__ == "__main__":
    unittest.main()

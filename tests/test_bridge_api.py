"""End-to-end tests for the QASWARA bridge HTTP API (real server, real shell)."""

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent.parent / "bridge"
sys.path.insert(0, str(BRIDGE_DIR))

import qaswara_bridge as jb  # noqa: E402

TOKEN = "test-token-abcdef123456"


class BridgeTestCase(unittest.TestCase):
    exec_per_minute = 200

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.cfg = jb.Config(
            host="127.0.0.1",
            port=0,
            workspace=root / "work",
            state_dir=root / "state",
            token=TOKEN,
            auth_required=True,
            serve_ui=True,
            web_root=BRIDGE_DIR.parent / "web",
            exec_per_minute=cls.exec_per_minute,
            allow_origins=("https://allowed.example",),
        )
        cls.server = jb.create_server(cls.cfg)
        cls.port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.tmp.cleanup()

    # ---------------- helpers ----------------

    def request(self, method, path, body=None, token=TOKEN, headers=None):
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("X-Jarvis-Token", token)
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw) if raw else {}, resp.headers
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {"raw": raw.decode("utf-8", "replace")}
            return err.code, payload, err.headers

    # ---------------- health / auth ----------------

    def test_health_is_public_and_reports_capabilities(self):
        status, payload, _ = self.request("GET", "/health", token=None)
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["authRequired"])
        self.assertEqual(payload["name"], "qaswara-bridge")
        self.assertIn("workspace", payload, "loopback callers also learn the workspace path")
        self.assertIn("exec", payload["tools"])

    def test_auth_is_required_for_execution(self):
        status, payload, _ = self.request(
            "POST", "/execute", {"code": "echo hi"}, token=None
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"]["code"], "unauthorized")

        status, _, _ = self.request("POST", "/execute", {"code": "echo hi"}, token="wrong-token")
        self.assertEqual(status, 401)

    def test_api_prefix_is_supported(self):
        status, payload, _ = self.request("POST", "/api/execute", {"code": "echo prefixed"})
        self.assertEqual(status, 200)
        self.assertIn("prefixed", payload["stdout"])

    # ---------------- execution ----------------

    def test_execute_bash(self):
        status, payload, _ = self.request(
            "POST", "/execute", {"code": "echo hello && printf 'a\\nb'", "lang": "bash"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["exitCode"], 0)
        self.assertIn("hello", payload["stdout"])
        self.assertEqual(payload["lang"], "bash")
        self.assertIn("durationMs", payload)

    def test_execute_python(self):
        status, payload, _ = self.request(
            "POST", "/execute", {"code": "print(6*7)", "lang": "python3"}
        )
        self.assertEqual(status, 200)
        self.assertIn("42", payload["stdout"])

    def test_nonzero_exit_is_reported_not_raised(self):
        status, payload, _ = self.request("POST", "/execute", {"code": "exit 3"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["exitCode"], 3)
        self.assertFalse(payload["ok"])

    def test_policy_blocks_catastrophic_command(self):
        status, payload, _ = self.request("POST", "/execute", {"code": "rm -rf /"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "policy_blocked")
        self.assertTrue(payload["error"]["reasons"])

    def test_cwd_cannot_escape_workspace(self):
        status, payload, _ = self.request(
            "POST", "/execute", {"code": "pwd", "cwd": "../../"}
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"]["code"], "policy_blocked")

    def test_unknown_lang_is_rejected(self):
        status, payload, _ = self.request("POST", "/execute", {"code": "puts 1", "lang": "ruby"})
        self.assertEqual(status, 403)

    def test_empty_code_is_rejected(self):
        status, payload, _ = self.request("POST", "/execute", {"code": "  "})
        self.assertEqual(status, 400)

    def test_timeout_kills_the_process(self):
        status, payload, _ = self.request(
            "POST", "/execute", {"code": "sleep 5", "timeout": 1}
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["timedOut"])
        self.assertEqual(payload["exitCode"], 124)

    def test_environment_secrets_are_not_exposed(self):
        import os

        os.environ["QASWARA_TEST_TOKEN_SECRET"] = "super-secret-value"
        try:
            status, payload, _ = self.request(
                "POST", "/execute", {"code": "env | grep -c QASWARA_TEST_TOKEN_SECRET || true"}
            )
            self.assertEqual(status, 200)
            self.assertEqual(payload["stdout"].strip(), "0")
        finally:
            os.environ.pop("QASWARA_TEST_TOKEN_SECRET", None)

    # ---------------- files ----------------

    def test_file_write_read_and_list(self):
        status, payload, _ = self.request(
            "POST", "/files/write", {"path": "notes/report.md", "content": "# تقرير\nسطر"}
        )
        self.assertEqual(status, 200)
        self.assertGreater(payload["bytes"], 0)

        status, payload, _ = self.request("POST", "/files/read", {"path": "notes/report.md"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["content"], "# تقرير\nسطر")
        self.assertEqual(payload["encoding"], "utf-8")

        status, payload, _ = self.request("POST", "/files/list", {"path": "notes"})
        self.assertEqual(status, 200)
        self.assertEqual([e["name"] for e in payload["entries"]], ["report.md"])

    def test_append_mode(self):
        self.request("POST", "/files/write", {"path": "log.txt", "content": "a\n"})
        self.request("POST", "/files/write", {"path": "log.txt", "content": "b\n", "append": True})
        _, payload, _ = self.request("POST", "/files/read", {"path": "log.txt"})
        self.assertEqual(payload["content"], "a\nb\n")

    def test_file_paths_cannot_escape_workspace(self):
        for path in ("../outside.txt", "/etc/passwd"):
            status, payload, _ = self.request("POST", "/files/read", {"path": path})
            self.assertEqual(status, 403, path)
            self.assertEqual(payload["error"]["code"], "policy_blocked")

    def test_missing_file_is_404(self):
        status, _, _ = self.request("POST", "/files/read", {"path": "nope.txt"})
        self.assertEqual(status, 404)

    # ---------------- memory ----------------

    def test_memory_crud_and_search(self):
        status, payload, _ = self.request(
            "POST", "/memory", {"kind": "preference", "content": "يفضّل التقارير المختصرة"}
        )
        self.assertEqual(status, 201)
        mem_id = payload["item"]["id"]

        status, payload, _ = self.request("GET", "/memory?limit=10")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["id"] == mem_id for item in payload["items"]))

        status, payload, _ = self.request("POST", "/memory/search", {"query": "التقارير"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["items"][0]["id"], mem_id)

        status, payload, _ = self.request("DELETE", f"/memory?id={mem_id}")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])

        status, _, _ = self.request("DELETE", f"/memory?id={mem_id}")
        self.assertEqual(status, 404)

    def test_memory_deduplicates_identical_content(self):
        _, first, _ = self.request("POST", "/memory", {"content": "معلومة مكررة"})
        _, second, _ = self.request("POST", "/memory", {"content": "معلومة مكررة"})
        self.assertEqual(first["item"]["id"], second["item"]["id"])

    def test_memory_short_content_is_rejected(self):
        status, _, _ = self.request("POST", "/memory", {"content": "x"})
        self.assertEqual(status, 403)

    def test_health_counts_memory(self):
        self.request("POST", "/memory", {"content": "عنصر للعد"})
        _, payload, _ = self.request("GET", "/health")
        self.assertGreaterEqual(payload["memoryCount"], 1)

    # ---------------- static UI + CORS ----------------

    def test_ui_is_served_with_injected_token(self):
        with urllib.request.urlopen(self.base + "/", timeout=10) as resp:
            body = resp.read().decode("utf-8")
            self.assertEqual(resp.status, 200)
            self.assertIn("QASWARA", body)
            self.assertIn('name="qaswara-bridge-token"', body)
            self.assertIn(TOKEN, body)

    def test_styles_and_modules_are_served(self):
        for path in ("/styles.css", "/js/app.js", "/manifest.webmanifest", "/icon.svg"):
            with urllib.request.urlopen(self.base + path, timeout=10) as resp:
                self.assertEqual(resp.status, 200, path)
                self.assertGreater(len(resp.read()), 0)

    def test_unknown_static_path_is_404(self):
        status, payload, _ = self.request("GET", "/nope.js")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "not_found")

    def test_cors_preflight_allows_listed_origin_only(self):
        status, _, headers = self.request(
            "OPTIONS",
            "/execute",
            token=None,
            headers={"Origin": "https://allowed.example", "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://allowed.example")
        self.assertEqual(headers.get("Access-Control-Allow-Private-Network"), "true")

        status, _, _ = self.request(
            "OPTIONS",
            "/execute",
            token=None,
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(status, 403)


class RateLimiterTest(unittest.TestCase):
    def test_limits_and_recovers(self):
        from qaswara_bridge import RateLimiter

        limiter = RateLimiter(per_minute=2)
        self.assertTrue(limiter.allow("ip"))
        self.assertTrue(limiter.allow("ip"))
        self.assertFalse(limiter.allow("ip"))
        self.assertTrue(limiter.allow("other-ip"))

    def test_custom_bucket_limit(self):
        from qaswara_bridge import RateLimiter

        limiter = RateLimiter(per_minute=100)
        for _ in range(3):
            self.assertTrue(limiter.allow("files:ip", limit=3))
        self.assertFalse(limiter.allow("files:ip", limit=3))


class MemoryStoreUnitTest(unittest.TestCase):
    def test_unknown_kind_falls_back_to_fact(self):
        from qaswara_bridge import MemoryStore

        with tempfile.TemporaryDirectory() as tmp:
            store = MemoryStore(Path(tmp) / "m.db")
            item = store.add("nonsense", "معلومة")
            self.assertEqual(item["kind"], "fact")
            self.assertEqual(store.count(), 1)


if __name__ == "__main__":
    unittest.main()


class BridgeFeatureTest(BridgeTestCase):
    """QASWARA v2 endpoints: uploads, raw streaming, office, media, audit, APK."""

    def test_upload_then_download_roundtrip(self):
        payload = {"hello": "مرحبا"}
        import base64

        raw = base64.b64encode("نص ثنائي".encode("utf-8")).decode("ascii")
        status, body, _ = self.request("POST", "/files/upload", {"path": "uploads/u.bin", "base64": raw, "mime": "text/plain"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["bytes"], len("نص ثنائي".encode("utf-8")))

        req = urllib.request.Request(f"{self.base}/files/raw?path=uploads/u.bin&token={TOKEN}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.read().decode("utf-8"), "نص ثنائي")

        denied = urllib.request.Request(f"{self.base}/files/raw?path=uploads/u.bin")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(denied, timeout=10)
        self.assertEqual(ctx.exception.code, 401)
        _ = payload

    def test_device_reports_capabilities_and_advice(self):
        status, body, _ = self.request("GET", "/device")
        self.assertEqual(status, 200, body)
        self.assertIn("capabilities", body)
        self.assertIn("shell", body["capabilities"])
        self.assertIsInstance(body["advice"], list)

    def test_office_create_and_extract(self):
        status, body, _ = self.request(
            "POST",
            "/office",
            {"kind": "xlsx", "path": "artifacts/t.xlsx", "payload": {"rows": [["أ", "ب"], ["1", "2"]]}},
        )
        self.assertEqual(status, 200, body)
        status, extracted, _ = self.request("POST", "/extract", {"path": "artifacts/t.xlsx"})
        self.assertEqual(status, 200, extracted)
        self.assertIn("1", extracted["text"])

    def test_audit_flags_eval(self):
        status, body, _ = self.request("POST", "/audit", {"code": "eval(input)", "lang": "javascript"})
        self.assertEqual(status, 200, body)
        self.assertLess(body["score"], 100)
        self.assertTrue(any("eval" in finding["rule"] for finding in body["findings"]))

    def test_app_export_bundle(self):
        status, body, _ = self.request(
            "POST", "/app/export", {"kind": "bundle", "name": "Demo", "files": {"index.html": "<h1>مرحبا</h1>"}}
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        self.assertTrue(body["path"].endswith(".zip"))

    def test_media_song_produces_files(self):
        status, body, _ = self.request(
            "POST", "/media", {"action": "song", "title": "اختبار", "lyrics": "سطر أول\nسطر ثانٍ", "seconds": 3, "vocals": False}
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["files"])

    def test_install_rejects_unknown_package(self):
        status, body, _ = self.request("POST", "/install", {"manager": "pkg", "name": "evilpkg"})
        self.assertEqual(status, 403, body)
        self.assertEqual(body["error"]["code"], "policy_blocked")

    def test_phone_rejects_invalid_action(self):
        status, body, _ = self.request("POST", "/phone", {"action": "hack"})
        self.assertEqual(status, 400, body)

#!/usr/bin/env python3
"""
QASWARA Bridge — the local "hand" of the agent (Termux on Android, or Linux).

Endpoints
  GET  /health              status & capabilities (public)
  GET  /device              full self-awareness snapshot + install advice
  POST /execute             bash | sh | python3 | node
  POST /install             allow-listed `pkg install` / `pip install`
  POST /files/{read,write,list,upload}
  GET/POST/DELETE /memory   SQLite + FTS5 long-term memory
  POST /memory/search
  POST /phone               contacts | call | sms | whatsapp | battery | clipboard | notify
  POST /capture             screenshot via rish/Shizuku (base64 PNG)
  POST /extract             text from PDF/DOCX/XLSX/TXT/code/images(OCR)
  POST /office              create PDF/XLSX/DOCX/CSV/MD/HTML/RTF/ZIP
  POST /media               song (wav/mp3) | video (mp4) | trim
  POST /app/export          bundle (always) + APK (when toolchain exists)
  POST /audit               Artemis static audit
  GET  /                    the QASWARA web UI (same origin, token injected)

Security: token auth on everything except /health and static files, closed CORS,
workspace confinement, catastrophic-command deny-list, installer allow-list,
optional --offline mode. Standard library only.
"""

from __future__ import annotations

import argparse
import base64
import html as html_module
import json
import os
import platform
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

BRIDGE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BRIDGE_DIR))

import appbuilder as apk_builder  # noqa: E402
import audit as artemis  # noqa: E402
import media as media_engine  # noqa: E402
import office  # noqa: E402
import policy as bridge_policy  # noqa: E402

VERSION = "2.0.0"
SERVER_NAME = "qaswara-bridge"
DEFAULT_PORT = 8080
MAX_FILE_BYTES = 8 * 1024 * 1024
MEMORY_KINDS = {"rule", "preference", "skill", "project", "fact", "note"}
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
}

TERMUX_COMMANDS = (
    "termux-contact-list", "termux-telephony-call", "termux-sms-send",
    "termux-battery-status", "termux-notification", "termux-clipboard-get",
    "termux-clipboard-set", "termux-open-url", "termux-camera-photo", "termux-toast",
)
OPTIONAL_BINARIES = (
    "rish", "ffmpeg", "ffprobe", "tesseract", "pdftotext", "espeak-ng",
    "espeak", "node", "git", "pkg", "pip", "screencap", "termux-api",
)
PYTHON_MODULES = ("pypdf", "openpyxl", "reportlab", "arabic_reshaper", "bidi", "PIL", "docx")


# --------------------------------------------------------------------------- #
# configuration                                                               #
# --------------------------------------------------------------------------- #


def default_workspace() -> Path:
    shared = Path("/sdcard/Qaswara_Workspace")
    try:
        if Path("/sdcard").is_dir():
            shared.mkdir(parents=True, exist_ok=True)
            probe = shared / ".write_test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            return shared
    except OSError:
        pass
    return Path.home() / "Qaswara_Workspace"


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = DEFAULT_PORT
    workspace: Path = field(default_factory=default_workspace)
    state_dir: Path = field(default_factory=lambda: Path.home() / ".qaswara")
    token: str = ""
    auth_required: bool = True
    allow_dangerous: bool = False
    allow_any_install: bool = False
    offline: bool = False
    allow_origins: Tuple[str, ...] = ()
    allow_file_origin: bool = False
    serve_ui: bool = True
    web_root: Path = field(default_factory=lambda: BRIDGE_DIR.parent / "web")
    max_body: int = 4 * 1024 * 1024
    max_output: int = 200_000
    exec_per_minute: int = 90
    verbose: bool = False

    def prepare(self) -> "Config":
        self.workspace = Path(self.workspace).expanduser().resolve()
        self.state_dir = Path(self.state_dir).expanduser().resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        (self.workspace / "artifacts").mkdir(exist_ok=True)
        (self.workspace / "exports").mkdir(exist_ok=True)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.state_dir, 0o700)
        except OSError:
            pass
        return self

    @property
    def origin_allowlist(self) -> set:
        allowed = set(self.allow_origins)
        for host in ("127.0.0.1", "localhost", "[::1]"):
            allowed.add(f"http://{host}:{self.port}")
        if self.allow_file_origin:
            allowed.add("null")
        return allowed


# --------------------------------------------------------------------------- #
# storage                                                                     #
# --------------------------------------------------------------------------- #


class MemoryStore:
    """SQLite memory with FTS5 ranking when the build supports it."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        self.fts = False
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    hits INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)")
            try:
                conn.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='rowid')"
                )
                conn.execute(
                    "CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN "
                    "INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content); END;"
                )
                conn.execute(
                    "CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN "
                    "INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content); END;"
                )
                conn.execute(
                    "CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN "
                    "INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content); "
                    "INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content); END;"
                )
                conn.execute("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
                self.fts = True
            except sqlite3.Error:
                self.fts = False
            conn.commit()
        try:
            os.chmod(self.db_path, 0o600)
        except OSError:
            pass

    @staticmethod
    def _row(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "content": row["content"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "hits": row["hits"],
        }

    def add(self, kind: str, content: str) -> Dict[str, Any]:
        if kind not in MEMORY_KINDS:
            kind = "fact"
        content = " ".join(str(content).split()).strip()
        if len(content) < 3:
            raise bridge_policy.PolicyError("content is too short")
        content = content[:4000]
        now = int(time.time() * 1000)
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT * FROM memories WHERE lower(content) = lower(?) LIMIT 1", (content,)
            ).fetchone()
            if existing:
                conn.execute("UPDATE memories SET updated_at = ? WHERE id = ?", (now, existing["id"]))
                conn.commit()
                return self._row(conn.execute("SELECT * FROM memories WHERE id = ?", (existing["id"],)).fetchone())
            mem_id = uuid.uuid4().hex[:16]
            conn.execute(
                "INSERT INTO memories (id, kind, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (mem_id, kind, content, now, now),
            )
            conn.commit()
            return self._row(conn.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone())

    def list(self, limit: int = 200, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 200), 1000))
        with self._lock, self._connect() as conn:
            if kind:
                rows = conn.execute(
                    "SELECT * FROM memories WHERE kind = ? ORDER BY created_at DESC LIMIT ?", (kind, limit)
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [self._row(r) for r in rows]

    def search(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 20), 100))
        words = [w for w in str(query).replace("%", " ").replace("_", " ").split() if len(w) > 1][:10]
        if not words:
            return []
        with self._lock, self._connect() as conn:
            rows: List[sqlite3.Row] = []
            if self.fts:
                match = " OR ".join(f'"{w}"' for w in words)
                try:
                    rows = conn.execute(
                        "SELECT m.* FROM memories m JOIN memories_fts f ON f.rowid = m.rowid "
                        "WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
                        (match, limit),
                    ).fetchall()
                except sqlite3.Error:
                    rows = []
            if not rows:
                where = " AND ".join("lower(content) LIKE ?" for _ in words)
                params = [f"%{w.lower()}%" for w in words] + [limit]
                rows = conn.execute(
                    f"SELECT * FROM memories WHERE {where} ORDER BY created_at DESC LIMIT ?", params
                ).fetchall()
            ids = [r["id"] for r in rows]
            if ids:
                conn.executemany("UPDATE memories SET hits = hits + 1 WHERE id = ?", [(i,) for i in ids])
                conn.commit()
        return [self._row(r) for r in rows]

    def delete(self, mem_id: str) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM memories WHERE id = ?", (str(mem_id),))
            conn.commit()
            return cur.rowcount > 0

    def count(self) -> int:
        with self._lock, self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0])


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = max(1, per_minute)
        self._hits: Dict[str, List[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, cost: int = 1, limit: Optional[int] = None) -> bool:
        limit = limit or self.per_minute
        now = time.time()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < 60]
            if len(hits) + cost > limit:
                self._hits[key] = hits
                return False
            hits.extend([now] * cost)
            self._hits[key] = hits
            return True


# --------------------------------------------------------------------------- #
# execution                                                                   #
# --------------------------------------------------------------------------- #


def truncate_output(text: str, limit: int) -> Tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    head = limit // 2
    tail = limit - head
    return f"{text[:head]}\n… [اختصار {len(text) - limit} حرفاً] …\n{text[-tail:]}", True


class Executor:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.semaphore = threading.Semaphore(2)
        self.bash = shutil.which("bash") or shutil.which("sh") or "/system/bin/sh"
        self.sh = shutil.which("sh") or self.bash
        self.python = shutil.which("python3") or shutil.which("python") or "python3"
        self.node = shutil.which("node")

    def _command(self, lang: str, code: str) -> List[str]:
        if lang in ("bash", "sh"):
            return [self.bash if lang == "bash" else self.sh, "-c", code]
        if lang == "node":
            if not self.node:
                raise bridge_policy.PolicyError("Node.js غير مثبّت (pkg install nodejs)")
            return [self.node, "-e", code]
        return [self.python, "-c", code]

    def _environment(self) -> Dict[str, str]:
        env = bridge_policy.scrub_env(dict(os.environ))
        env.setdefault("TERM", "xterm-256color")
        env["QASWARA_WORKSPACE"] = str(self.cfg.workspace)
        env["QASWARA_BRIDGE"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("LANG", "C.UTF-8")
        return env

    def run(self, code: str, lang: str, cwd: str, timeout: int) -> Dict[str, Any]:
        lang = bridge_policy.validate_lang(lang)
        verdict = bridge_policy.assess(code, allow_dangerous=self.cfg.allow_dangerous)
        if not verdict.allowed:
            raise ApiError(
                HTTPStatus.FORBIDDEN,
                "policy_blocked",
                "الجسر رفض تنفيذ هذا الأمر: " + "، ".join(verdict.reasons),
                {"reasons": verdict.reasons},
            )
        if self.cfg.offline:
            net = bridge_policy.assess_network(code)
            if not net.allowed:
                raise ApiError(
                    HTTPStatus.FORBIDDEN,
                    "offline_blocked",
                    "قاطع الإنترنت على الجسر مفعّل: " + "، ".join(net.reasons),
                    {"reasons": net.reasons},
                )

        workdir = bridge_policy.safe_join(str(self.cfg.workspace), cwd or ".")
        if not os.path.isdir(workdir):
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_cwd", f"مجلد العمل غير موجود: {cwd}")

        timeout = bridge_policy.clamp_timeout(timeout)
        if not self.semaphore.acquire(timeout=15):
            raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "busy", "الجسر مشغول بأوامر أخرى، أعد المحاولة.")

        started = time.time()
        try:
            proc = subprocess.Popen(
                self._command(lang, code),
                cwd=workdir,
                env=self._environment(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                text=True,
                errors="replace",
                start_new_session=True,
            )
            timed_out = False
            try:
                stdout, stderr = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    proc.kill()
                stdout, stderr = proc.communicate()

            stdout, cut_out = truncate_output(stdout or "", self.cfg.max_output)
            stderr, cut_err = truncate_output(stderr or "", self.cfg.max_output)
            duration_ms = int((time.time() - started) * 1000)
            exit_code = 124 if timed_out else (proc.returncode if proc.returncode is not None else -1)
            if timed_out:
                stderr = (stderr + f"\n[انتهت المهلة بعد {timeout} ثانية وأُوقفت العملية]").strip()

            return {
                "ok": exit_code == 0,
                "exitCode": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "durationMs": duration_ms,
                "timedOut": timed_out,
                "truncated": cut_out or cut_err,
                "cwd": os.path.relpath(workdir, self.cfg.workspace) or ".",
                "lang": lang,
            }
        finally:
            self.semaphore.release()


# --------------------------------------------------------------------------- #
# device awareness                                                            #
# --------------------------------------------------------------------------- #


class DeviceProbe:
    """Cached capability snapshot used by /device and the UI status panel."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._lock = threading.Lock()
        self._cache: Optional[Dict[str, Any]] = None
        self._at = 0.0
        self._server: Optional["QaswaraServer"] = None

    def attach(self, server: "QaswaraServer") -> None:
        self._server = server

    def snapshot(self, refresh: bool = False) -> Dict[str, Any]:
        with self._lock:
            if not refresh and self._cache and time.time() - self._at < 30:
                return self._cache
            data = self._build()
            self._cache = data
            self._at = time.time()
            return data

    def _build(self) -> Dict[str, Any]:
        binaries = {name: bool(shutil.which(name)) for name in TERMUX_COMMANDS + OPTIONAL_BINARIES}
        modules = {}
        for name in PYTHON_MODULES:
            try:
                __import__(name)
                modules[name] = True
            except Exception:
                modules[name] = False

        storage_ok = False
        free = None
        try:
            usage = shutil.disk_usage(str(self.cfg.workspace))
            free = usage.free
            probe = self.cfg.workspace / ".qaswara_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            storage_ok = True
        except OSError:
            storage_ok = False

        rish = binaries.get("rish", False)
        termux_api = binaries.get("termux-api", False) or binaries.get("termux-contact-list", False)
        ffmpeg = binaries.get("ffmpeg", False)
        tesseract = binaries.get("tesseract", False)
        pdftotext = binaries.get("pdftotext", False)

        capabilities = {
            "shell": True,
            "files": storage_ok,
            "screen_capture": rish,
            "camera_bridge": binaries.get("termux-camera-photo", False),
            "contacts": binaries.get("termux-contact-list", False),
            "call": binaries.get("termux-telephony-call", False),
            "sms": binaries.get("termux-sms-send", False),
            "notifications": binaries.get("termux-notification", False),
            "clipboard": binaries.get("termux-clipboard-get", False),
            "media_audio": ffmpeg,
            "media_video": ffmpeg,
            "ocr": tesseract,
            "pdf_text": pdftotext or modules.get("pypdf", False),
            "office_stdlib": True,
            "office_pdf": modules.get("reportlab", False),
            "apk_build": not apk_builder.missing_tools(),
            "memory_fts": bool(self._server and self._server.memory.fts),
            "internet": not self.cfg.offline,
        }

        advice = []
        if not termux_api:
            advice.append({"need": "termux-api", "install": "pkg install termux-api + ثبّت تطبيق Termux:API",
                           "unlocks": "جهات الاتصال، الاتصال، SMS، الإشعارات، الحافظة"})
        if not rish:
            advice.append({"need": "rish", "install": "ثبّت Shizuku ثم انسخ rish إلى ~/bin",
                           "unlocks": "تصوير الشاشة، أوامر am، فتح التطبيقات"})
        if not ffmpeg:
            advice.append({"need": "ffmpeg", "install": "pkg install ffmpeg", "unlocks": "mp3 / mp4 / قص الصوت"})
        if not tesseract:
            advice.append({"need": "tesseract", "install": "pkg install tesseract", "unlocks": "OCR للصور واللقطات"})
        if not capabilities["pdf_text"]:
            advice.append({"need": "poppler", "install": "pkg install poppler", "unlocks": "استخراج نص PDF"})
        if not modules.get("reportlab"):
            advice.append({"need": "reportlab", "install": "pip install reportlab arabic-reshaper python-bidi",
                           "unlocks": "تصدير PDF عربي"})
        if apk_builder.missing_tools():
            advice.append({"need": "android-sdk", "install": "يُبنى عبر GitHub Actions (android.yml)",
                           "unlocks": "ملف APK جاهز للتثبيت"})

        return {
            "ok": True,
            "name": SERVER_NAME,
            "version": VERSION,
            "platform": platform.platform(),
            "python": platform.python_version(),
            "workspace": str(self.cfg.workspace),
            "storageFreeBytes": free,
            "stateDir": str(self.cfg.state_dir),
            "authRequired": bool(self.cfg.auth_required),
            "offline": bool(self.cfg.offline),
            "dangerousAllowed": bool(self.cfg.allow_dangerous),
            "binaries": binaries,
            "pythonModules": modules,
            "capabilities": capabilities,
            "advice": advice,
            "memoryCount": self._server.memory.count() if self._server else 0,
            "memoryFts": bool(self._server and self._server.memory.fts),
            "uptimeSec": int(time.time() - self._server.started_at) if self._server else 0,
        }



# --------------------------------------------------------------------------- #
# HTTP                                                                        #
# --------------------------------------------------------------------------- #


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: Optional[dict] = None):
        super().__init__(message)
        self.status = int(status)
        self.code = code
        self.message = message
        self.extra = extra or {}


class QaswaraServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr: Tuple[str, int], handler, cfg: Config):
        self.cfg = cfg
        self.memory = MemoryStore(cfg.state_dir / "memory.db")
        self.executor = Executor(cfg)
        self.rates = RateLimiter(cfg.exec_per_minute)
        self.started_at = time.time()
        self.probe = DeviceProbe(cfg)
        self.probe.attach(self)
        super().__init__(addr, handler)


class Handler(BaseHTTPRequestHandler):
    server: QaswaraServer
    protocol_version = "HTTP/1.1"
    server_version = f"{SERVER_NAME}/{VERSION}"

    @property
    def cfg(self) -> Config:
        return self.server.cfg

    # ---------------- plumbing ----------------

    def log_message(self, fmt: str, *args) -> None:
        if self.cfg.verbose:
            sys.stderr.write(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}\n")

    def _client(self) -> str:
        return self.client_address[0] if self.client_address else "?"

    def _is_loopback(self) -> bool:
        return self._client() in LOOPBACK

    def _cors_headers(self) -> Dict[str, str]:
        origin = self.headers.get("Origin")
        if not origin or origin not in self.cfg.origin_allowlist:
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Qaswara-Token, X-Jarvis-Token, Accept",
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_error_json(self, err: ApiError) -> None:
        payload = {"ok": False, "error": {"code": err.code, "message": err.message}}
        payload["error"].update(err.extra)
        self._send_json(err.status, payload)

    def _send_bytes(self, status: int, body: bytes, content_type: str, extra: Optional[Dict[str, str]] = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_length", "Content-Length غير صالح")
        if length <= 0:
            return {}
        if length > self.cfg.max_body:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", "حجم الطلب أكبر من الحد المسموح")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_json", "الطلب ليس JSON صالحاً")
        if not isinstance(data, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_json", "الطلب يجب أن يكون كائن JSON")
        return data

    def _check_auth(self) -> None:
        if not self.cfg.auth_required:
            return
        supplied = self.headers.get("X-Qaswara-Token") or self.headers.get("X-Jarvis-Token") or ""
        auth = self.headers.get("Authorization") or ""
        if not supplied and auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
        if not supplied or not secrets.compare_digest(supplied, self.cfg.token):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "unauthorized", "رمز الجسر غير صحيح أو مفقود.")

    def _rate(self, bucket: str, limit: Optional[int] = None) -> None:
        if not self.server.rates.allow(f"{bucket}:{self._client()}", limit=limit):
            raise ApiError(HTTPStatus.TOO_MANY_REQUESTS, "rate_limited", "عدد الطلبات كبير — انتظر دقيقة.")

    def _path(self) -> str:
        path = urlparse(self.path).path or "/"
        if path.startswith("/api/"):
            path = path[4:]
        return path

    # ---------------- verbs ----------------

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin = self.headers.get("Origin")
        if origin and origin not in self.cfg.origin_allowlist:
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": {"code": "cors", "message": "origin not allowed"}})
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    PROTECTED_PREFIXES = ("/execute", "/files", "/memory", "/install", "/phone", "/capture",
                          "/extract", "/office", "/media", "/app", "/audit", "/device")

    def _dispatch(self, method: str) -> None:
        path = self._path()
        try:
            if path == "/health":
                self._health()
                return
            if method == "GET" and path == "/files/raw":
                self._file_raw()
                return
            if method == "GET" and not path.startswith(self.PROTECTED_PREFIXES):
                self._static(path)
                return
            self._check_auth()
            routes = {
                ("/execute", "POST"): self._execute,
                ("/install", "POST"): self._install,
                ("/device", "GET"): self._device,
                ("/files/read", "POST"): self._file_read,
                ("/files/read", "GET"): self._file_read,
                ("/files/write", "POST"): self._file_write,
                ("/files/list", "POST"): self._file_list,
                ("/files/upload", "POST"): self._file_upload,
                ("/files/list", "GET"): self._file_list,
                ("/memory", "GET"): self._memory_list,
                ("/memory", "POST"): self._memory_add,
                ("/memory", "DELETE"): self._memory_delete,
                ("/memory/search", "POST"): self._memory_search,
                ("/phone", "POST"): self._phone,
                ("/capture", "POST"): self._capture,
                ("/extract", "POST"): self._extract,
                ("/office", "POST"): self._office,
                ("/media", "POST"): self._media,
                ("/app/export", "POST"): self._app_export,
                ("/audit", "POST"): self._audit,
            }
            handler = routes.get((path, method))
            if not handler:
                raise ApiError(HTTPStatus.NOT_FOUND, "not_found", f"مسار غير معروف: {path}")
            handler()
        except ApiError as err:
            self._send_error_json(err)
        except bridge_policy.PolicyError as err:
            self._send_error_json(ApiError(HTTPStatus.FORBIDDEN, "policy_blocked", str(err)))
        except office.OfficeError as err:
            self._send_error_json(
                ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, err.code, str(err), {"install": err.install} if err.install else None)
            )
        except media_engine.MediaError as err:
            self._send_error_json(
                ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, err.code, str(err), {"install": err.install} if err.install else None)
            )
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self._send_error_json(ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "internal", "خطأ داخلي في الجسر — راجع سجل الطرفية."))

    # ---------------- basic ----------------

    def _health(self) -> None:
        payload = {
            "ok": True,
            "name": SERVER_NAME,
            "version": VERSION,
            "platform": platform.platform(),
            "python": platform.python_version(),
            "authRequired": bool(self.cfg.auth_required),
            "dangerousAllowed": bool(self.cfg.allow_dangerous),
            "offline": bool(self.cfg.offline),
            "memoryCount": self.server.memory.count(),
            "memoryFts": self.server.memory.fts,
            "uptimeSec": int(time.time() - self.server.started_at),
            "shell": os.path.basename(self.server.executor.bash),
            "tools": ["exec", "read_file", "write_file", "list_dir", "memory_search", "memory_save",
                      "device_info", "install_tool", "phone", "capture_screen", "extract_file",
                      "create_document", "synth_media", "export_app", "audit_code"],
        }
        if self._is_loopback() or not self.cfg.auth_required:
            payload["workspace"] = str(self.cfg.workspace)
        self._send_json(HTTPStatus.OK, payload)

    def _device(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        refresh = (query.get("refresh") or ["0"])[0] in ("1", "true")
        data = self.server.probe.snapshot(refresh=refresh)
        # keep counts fresh without a full re-probe
        data["memoryCount"] = self.server.memory.count()
        data["memoryFts"] = self.server.memory.fts
        self._send_json(HTTPStatus.OK, data)

    def _execute(self) -> None:
        self._rate("exec")
        data = self._read_json()
        code = data.get("code") or data.get("command") or ""
        if not isinstance(code, str) or not code.strip():
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "الحقل code مطلوب")
        result = self.server.executor.run(
            code=code,
            lang=str(data.get("lang") or "bash"),
            cwd=str(data.get("cwd") or "."),
            timeout=data.get("timeout") or bridge_policy.DEFAULT_TIMEOUT,
        )
        self._send_json(HTTPStatus.OK, result)

    def _install(self) -> None:
        self._rate("install", limit=10)
        if self.cfg.offline:
            raise ApiError(HTTPStatus.FORBIDDEN, "offline_blocked", "قاطع الإنترنت مفعّل: التثبيت يحتاج شبكة.")
        data = self._read_json()
        manager = str(data.get("manager") or "pkg")
        name = bridge_policy.validate_install(manager, str(data.get("name") or ""), allow_any=self.cfg.allow_any_install)
        if manager == "pkg":
            binary = shutil.which("pkg")
            if not binary:
                raise ApiError(HTTPStatus.BAD_REQUEST, "no_pkg", "مدير الحزم pkg غير متاح على هذا النظام.")
            command = [binary, "install", "-y", name]
        else:
            command = [sys.executable, "-m", "pip", "install", "--user", "--upgrade", name]

        started = time.time()
        try:
            proc = subprocess.run(command, capture_output=True, text=True, timeout=900)
        except subprocess.TimeoutExpired:
            raise ApiError(HTTPStatus.GATEWAY_TIMEOUT, "install_timeout", "استغرق التثبيت أكثر من ١٥ دقيقة.")
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": proc.returncode == 0,
                "manager": manager,
                "name": name,
                "exitCode": proc.returncode,
                "durationMs": int((time.time() - started) * 1000),
                "output": truncate_output((proc.stdout or "") + (proc.stderr or ""), 12000)[0],
            },
        )

    # ---------------- files ----------------

    def _file_read(self) -> None:
        self._rate("files")
        if self.command == "GET":
            query = parse_qs(urlparse(self.path).query)
            path = (query.get("path") or [""])[0]
        else:
            path = str(self._read_json().get("path") or "")
        target = bridge_policy.safe_join(str(self.cfg.workspace), path)
        if not os.path.isfile(target):
            raise ApiError(HTTPStatus.NOT_FOUND, "not_found", f"الملف غير موجود: {path}")
        size = os.path.getsize(target)
        if size > MAX_FILE_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", "الملف أكبر من 8 MB")
        with open(target, "rb") as handle:
            raw = handle.read()
        try:
            text = raw.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError:
            text = base64.b64encode(raw).decode("ascii")
            encoding = "base64"
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "path": os.path.relpath(target, self.cfg.workspace),
                "content": text,
                "encoding": encoding,
                "size": size,
            },
        )

    def _file_write(self) -> None:
        self._rate("files")
        data = self._read_json()
        path = str(data.get("path") or "")
        content = data.get("content")
        if content is None:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "الحقل content مطلوب")
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", "المحتوى أكبر من 8 MB")
        target = bridge_policy.safe_join(str(self.cfg.workspace), path)
        os.makedirs(os.path.dirname(target) or str(self.cfg.workspace), exist_ok=True)
        mode = "a" if data.get("append") else "w"
        with open(target, mode, encoding="utf-8") as handle:
            handle.write(content)
        self._send_json(
            HTTPStatus.OK,
            {"ok": True, "path": os.path.relpath(target, self.cfg.workspace),
             "bytes": len(content.encode("utf-8"))},
        )

    def _file_upload(self) -> None:
        """Binary upload (camera frames, PDFs, images) as base64."""
        self._rate("files")
        data = self._read_json()
        path = str(data.get("path") or "")
        encoded = data.get("base64")
        if not isinstance(encoded, str) or not encoded.strip():
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "الحقل base64 مطلوب")
        if encoded.startswith("data:") and "," in encoded:
            encoded = encoded.split(",", 1)[1]
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_base64", "ترميز base64 غير صالح")
        if len(raw) > MAX_FILE_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", "الملف أكبر من 8 MB")
        target = bridge_policy.safe_join(str(self.cfg.workspace), path)
        os.makedirs(os.path.dirname(target) or str(self.cfg.workspace), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(raw)
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "path": os.path.relpath(target, self.cfg.workspace),
                "bytes": len(raw),
                "mime": str(data.get("mime") or "application/octet-stream"),
            },
        )

    RAW_TYPES = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
        ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf",
        ".zip": "application/zip", ".apk": "application/vnd.android.package-archive",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".csv": "text/csv; charset=utf-8", ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def _file_raw(self) -> None:
        """Stream a workspace file to the browser (audio/video/image/APK).

        `<audio>`, `<img>` and `<a download>` cannot send custom headers, so the
        bridge accepts `?token=` for this single route. The token is compared in
        constant time and the path is confined to the workspace.
        """
        if self.cfg.auth_required:
            query = parse_qs(urlparse(self.path).query)
            supplied = (
                self.headers.get("X-Qaswara-Token")
                or self.headers.get("X-Jarvis-Token")
                or (query.get("token") or [""])[0]
            )
            if not supplied or not secrets.compare_digest(supplied, self.cfg.token):
                raise ApiError(HTTPStatus.UNAUTHORIZED, "unauthorized", "رمز الجسر غير صحيح أو مفقود.")
        rel = (parse_qs(urlparse(self.path).query).get("path") or [""])[0]
        if not rel:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "الحقل path مطلوب")
        target = bridge_policy.safe_join(str(self.cfg.workspace), rel)
        if not os.path.isfile(target):
            raise ApiError(HTTPStatus.NOT_FOUND, "not_found", "الملف غير موجود")
        size = os.path.getsize(target)
        if size > 512 * 1024 * 1024:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", "الملف أكبر من حد العرض")
        suffix = os.path.splitext(target)[1].lower()
        mime = self.RAW_TYPES.get(suffix, "application/octet-stream")
        self.send_response(HTTPStatus.OK)
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        name = os.path.basename(target)
        self.send_header("Content-Disposition", f'inline; filename="{name.encode("ascii", "ignore").decode() or "file"}"')
        self.end_headers()
        with open(target, "rb") as handle:
            while True:
                chunk = handle.read(256 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _file_list(self) -> None:
        self._rate("files")
        if self.command == "GET":
            query = parse_qs(urlparse(self.path).query)
            path = (query.get("path") or ["."])[0]
        else:
            path = str(self._read_json().get("path") or ".")
        target = bridge_policy.safe_join(str(self.cfg.workspace), path)
        if not os.path.isdir(target):
            raise ApiError(HTTPStatus.NOT_FOUND, "not_found", f"المجلد غير موجود: {path}")
        entries = []
        with os.scandir(target) as it:
            for entry in it:
                if entry.name.startswith(".qaswara") or entry.name.startswith(".jarvis"):
                    continue
                try:
                    stat = entry.stat(follow_symlinks=False)
                    is_dir = entry.is_dir(follow_symlinks=False)
                    entries.append(
                        {
                            "name": entry.name,
                            "type": "dir" if is_dir else "file",
                            "size": None if is_dir else stat.st_size,
                            "modified": int(stat.st_mtime),
                        }
                    )
                except OSError:
                    continue
        entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
        self._send_json(
            HTTPStatus.OK,
            {"ok": True, "path": os.path.relpath(target, self.cfg.workspace) or ".", "entries": entries[:500]},
        )

    # ---------------- memory ----------------

    def _memory_list(self) -> None:
        self._rate("memory", limit=300)
        query = parse_qs(urlparse(self.path).query)
        limit = int((query.get("limit") or ["200"])[0] or 200)
        kind = (query.get("kind") or [None])[0]
        items = self.server.memory.list(limit=limit, kind=kind)
        self._send_json(HTTPStatus.OK, {"ok": True, "items": items, "count": len(items), "fts": self.server.memory.fts})

    def _memory_add(self) -> None:
        self._rate("memory", limit=300)
        data = self._read_json()
        item = self.server.memory.add(str(data.get("kind") or "fact"), str(data.get("content") or ""))
        self._send_json(HTTPStatus.CREATED, {"ok": True, "item": item})

    def _memory_delete(self) -> None:
        self._rate("memory", limit=300)
        query = parse_qs(urlparse(self.path).query)
        mem_id = (query.get("id") or [""])[0]
        if not mem_id:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "الحقل id مطلوب")
        deleted = self.server.memory.delete(mem_id)
        self._send_json(HTTPStatus.OK if deleted else HTTPStatus.NOT_FOUND, {"ok": deleted, "id": mem_id})

    def _memory_search(self) -> None:
        self._rate("memory", limit=300)
        data = self._read_json()
        query = str(data.get("query") or "").strip()
        if not query:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "الحقل query مطلوب")
        items = self.server.memory.search(query, limit=data.get("limit") or 20)
        self._send_json(HTTPStatus.OK, {"ok": True, "items": items, "count": len(items), "fts": self.server.memory.fts})

    # ---------------- phone ----------------

    def _run_tool(self, command: List[str], timeout: int = 30) -> Tuple[bool, str, str]:
        binary = shutil.which(command[0])
        if not binary:
            return False, "", f"MISSING:{command[0]}"
        try:
            proc = subprocess.run([binary] + command[1:], capture_output=True, text=True, timeout=timeout)
            return proc.returncode == 0, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired:
            return False, "", "TIMEOUT"
        except OSError as err:
            return False, "", str(err)

    def _phone(self) -> None:
        self._rate("phone", limit=60)
        data = self._read_json()
        action = str(data.get("action") or "").strip().lower()

        if action == "contacts":
            ok, out, err = self._run_tool(["termux-contact-list"])
            if not ok:
                raise self._missing_termux_api("termux-contact-list", err)
            try:
                contacts = json.loads(out or "[]")
            except json.JSONDecodeError:
                contacts = []
            query = bridge_policy.clean_text(data.get("query") or "", 80).lower()
            matches = [
                c for c in contacts
                if not query or query in str(c.get("name", "")).lower() or query in str(c.get("number", ""))
            ][:40]
            self._send_json(HTTPStatus.OK, {"ok": True, "action": "contacts", "count": len(matches),
                                            "contacts": [{"name": c.get("name"), "number": c.get("number")} for c in matches]})
            return

        if action == "call":
            number = bridge_policy.validate_phone_number(data.get("number") or "")
            ok, _out, err = self._run_tool(["termux-telephony-call", number])
            if ok:
                self._send_json(HTTPStatus.OK, {"ok": True, "action": "call", "method": "termux-telephony-call", "number": number})
                return
            if shutil.which("rish"):
                code = f'am start -a android.intent.action.CALL -d tel:{number}'
                ok2, _o2, err2 = self._run_tool(["rish", "-c", code])
                if ok2:
                    self._send_json(HTTPStatus.OK, {"ok": True, "action": "call", "method": "rish", "number": number})
                    return
                raise ApiError(HTTPStatus.BAD_GATEWAY, "call_failed", f"فشل الاتصال: {err or err2}")
            raise self._missing_termux_api("termux-telephony-call", err)

        if action == "sms":
            number = bridge_policy.validate_phone_number(data.get("number") or "")
            text = bridge_policy.clean_text(data.get("text") or "", 900)
            if not text:
                raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "نص الرسالة مطلوب")
            ok, _out, err = self._run_tool(["termux-sms-send", "-n", number, text])
            if not ok:
                raise self._missing_termux_api("termux-sms-send", err)
            self._send_json(HTTPStatus.OK, {"ok": True, "action": "sms", "number": number, "chars": len(text)})
            return

        if action == "whatsapp":
            number = bridge_policy.validate_phone_number(data.get("number") or "").lstrip("+")
            text = bridge_policy.clean_text(data.get("text") or "", 900)
            from urllib.parse import quote

            url = f"https://wa.me/{number}" + (f"?text={quote(text)}" if text else "")
            ok, _out, err = self._run_tool(["termux-open-url", url])
            if not ok:
                if shutil.which("rish"):
                    ok2, _o2, err2 = self._run_tool(["rish", "-c", f'am start -a android.intent.action.VIEW -d "{url}"'])
                    if ok2:
                        self._send_json(HTTPStatus.OK, {"ok": True, "action": "whatsapp", "method": "rish", "number": number})
                        return
                raise self._missing_termux_api("termux-open-url", err)
            self._send_json(HTTPStatus.OK, {"ok": True, "action": "whatsapp", "number": number, "draft": bool(text)})
            return

        if action == "battery":
            ok, out, err = self._run_tool(["termux-battery-status"])
            if not ok:
                raise self._missing_termux_api("termux-battery-status", err)
            self._send_json(HTTPStatus.OK, {"ok": True, "action": "battery", "battery": json.loads(out or "{}")})
            return

        if action == "notify":
            title = bridge_policy.clean_text(data.get("title") or "قسورة", 80)
            body = bridge_policy.clean_text(data.get("text") or "", 400)
            ok, _out, err = self._run_tool(["termux-notification", "--title", title, "--content", body])
            if not ok:
                raise self._missing_termux_api("termux-notification", err)
            self._send_json(HTTPStatus.OK, {"ok": True, "action": "notify"})
            return

        if action == "clipboard":
            operation = str(data.get("operation") or "get")
            if operation == "set":
                text = bridge_policy.clean_text(data.get("text") or "", 4000)
                ok, _out, err = self._run_tool(["termux-clipboard-set", text])
                if not ok:
                    raise self._missing_termux_api("termux-clipboard-set", err)
                self._send_json(HTTPStatus.OK, {"ok": True, "action": "clipboard", "operation": "set"})
                return
            ok, out, err = self._run_tool(["termux-clipboard-get"])
            if not ok:
                raise self._missing_termux_api("termux-clipboard-get", err)
            self._send_json(HTTPStatus.OK, {"ok": True, "action": "clipboard", "text": out[:4000]})
            return

        raise ApiError(
            HTTPStatus.BAD_REQUEST,
            "bad_action",
            "action يجب أن تكون: contacts | call | sms | whatsapp | battery | notify | clipboard",
        )

    def _missing_termux_api(self, tool: str, detail: str) -> ApiError:
        return ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "missing_tool",
            f"الأداة {tool} غير مثبّتة. ثبّت Termux:API ثم: pkg install termux-api",
            {"install": {"manager": "pkg", "name": "termux-api"}, "detail": (detail or "")[:300]},
        )

    # ---------------- screen capture ----------------

    def _capture(self) -> None:
        self._rate("capture", limit=30)
        self._read_json()
        artifacts = os.path.join(str(self.cfg.workspace), "artifacts")
        os.makedirs(artifacts, exist_ok=True)
        filename = f"screen_{int(time.time())}.png"
        target = os.path.join(artifacts, filename)

        attempts = []
        if shutil.which("rish"):
            device_path = target if str(self.cfg.workspace).startswith("/sdcard") else f"/sdcard/{filename}"
            ok, out, err = self._run_tool(["rish", "-c", f'screencap -p "{device_path}"'], timeout=30)
            attempts.append(("rish", ok, (err or out)[:200]))
            if ok and os.path.isfile(target):
                return self._send_capture(target, "rish")
            if ok and os.path.isfile(device_path):
                return self._send_capture(device_path, "rish")

        if shutil.which("screencap"):
            ok, out, err = self._run_tool(["screencap", "-p", target], timeout=30)
            attempts.append(("screencap", ok, (err or out)[:200]))
            if ok and os.path.isfile(target):
                return self._send_capture(target, "screencap")

        if shutil.which("termux-camera-photo"):
            attempts.append(("termux-camera-photo", False, "أداة كاميرا لا لقطة شاشة"))

        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "capture_unavailable",
            "تصوير الشاشة يحتاج Shizuku (rish) أو صلاحية الجذر. بديل فوري: استخدم زر «مشاركة الشاشة» في المتصفح أو «الكاميرا».",
            {
                "attempts": [{"method": m, "ok": ok, "detail": d} for m, ok, d in attempts],
                "install": {"need": "rish", "hint": "ثبّت Shizuku وانسخ rish إلى ~/bin"},
            },
        )

    def _send_capture(self, path: str, method: str) -> None:
        with open(path, "rb") as handle:
            raw = handle.read()
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "method": method,
                "mime": "image/png",
                "base64": base64.b64encode(raw).decode("ascii"),
                "bytes": len(raw),
                "path": os.path.relpath(path, self.cfg.workspace),
            },
        )

    # ---------------- documents / media / apps ----------------

    def _extract(self) -> None:
        self._rate("extract", limit=60)
        data = self._read_json()
        path = bridge_policy.safe_join(str(self.cfg.workspace), str(data.get("path") or ""))
        result = office.extract(path)
        result["relative"] = os.path.relpath(path, self.cfg.workspace)
        self._send_json(HTTPStatus.OK, result)

    def _office(self) -> None:
        self._rate("office", limit=60)
        data = self._read_json()
        kind = str(data.get("kind") or "").lower()
        path = bridge_policy.safe_join(
            str(self.cfg.workspace), str(data.get("path") or f"artifacts/qaswara.{kind or 'pdf'}")
        )
        result = office.create(kind, path, data.get("payload") or {})
        result["path"] = os.path.relpath(path, self.cfg.workspace)
        self._send_json(HTTPStatus.OK, result)

    def _media(self) -> None:
        self._rate("media", limit=20)
        data = self._read_json()
        action = str(data.get("action") or "song").lower()
        out_dir = bridge_policy.safe_join(str(self.cfg.workspace), str(data.get("outDir") or "artifacts"))

        if action == "song":
            result = media_engine.make_song(
                out_dir=out_dir,
                title=str(data.get("title") or "qaswara"),
                lyrics=str(data.get("lyrics") or ""),
                bpm=int(data.get("bpm") or 92),
                seconds=float(data.get("seconds") or 24),
                scale=str(data.get("scale") or "hijaz"),
                mood=str(data.get("mood") or "epic"),
                with_vocals=bool(data.get("vocals", True)),
            )
        elif action == "video":
            images = [
                bridge_policy.safe_join(str(self.cfg.workspace), p)
                for p in (data.get("images") or [])
                if isinstance(p, str) and p.strip()
            ]
            audio = data.get("audio")
            audio_path = bridge_policy.safe_join(str(self.cfg.workspace), audio) if audio else None
            result = media_engine.make_video(
                out_dir=out_dir,
                images=images,
                audio=audio_path,
                seconds_per_image=float(data.get("secondsPerImage") or 3),
                title=str(data.get("title") or "qaswara_video"),
            )
        elif action == "trim":
            source = bridge_policy.safe_join(str(self.cfg.workspace), str(data.get("source") or ""))
            result = media_engine.trim_audio(
                source=source,
                out_dir=out_dir,
                start=float(data.get("start") or 0),
                duration=float(data.get("duration") or 10),
            )
        else:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_action", "action يجب أن تكون: song | video | trim")

        for key in ("path", "primary"):
            if isinstance(result.get(key), str):
                result[key] = os.path.relpath(result[key], self.cfg.workspace)
        if isinstance(result.get("files"), list):
            result["files"] = [
                os.path.relpath(f, self.cfg.workspace) if f.startswith(str(self.cfg.workspace)) else f
                for f in result["files"]
            ]
        self._send_json(HTTPStatus.OK, result)

    def _app_export(self) -> None:
        self._rate("export", limit=10)
        data = self._read_json()
        kind = str(data.get("kind") or "bundle").lower()
        name = str(data.get("name") or "Qaswara")
        files = data.get("files") or {}
        if not isinstance(files, dict) or not files:
            raise ApiError(HTTPStatus.BAD_REQUEST, "bad_request", "مرّر files: {اسم الملف: المحتوى}")
        clean_files = {}
        for filename, content in list(files.items())[:200]:
            clean_files[str(filename)] = str(content)
        out_dir = os.path.join(str(self.cfg.workspace), "exports")
        os.makedirs(out_dir, exist_ok=True)

        if kind == "apk":
            result = apk_builder.build_webview_apk(out_dir, clean_files)
            # Deliver a ready-to-tap APK in the phone's Downloads folder.
            if result.get("ok") and isinstance(result.get("path"), str):
                downloads = Path("/sdcard/Download")
                if downloads.is_dir():
                    try:
                        target = downloads / "Qaswara.apk"
                        shutil.copyfile(result["path"], target)
                        result["download"] = str(target)
                        result["note"] = "ثبّته من /sdcard/Download/Qaswara.apk (فعّل «تثبيت من مصادر غير معروفة»)."
                    except OSError:
                        pass
        else:
            result = apk_builder.write_bundle(out_dir, name, clean_files)

        for key in ("path", "bundle"):
            if isinstance(result.get(key), str):
                result[key] = os.path.relpath(result[key], self.cfg.workspace)
        self._send_json(HTTPStatus.OK, result)

    def _audit(self) -> None:
        self._rate("audit", limit=60)
        data = self._read_json()
        if data.get("code"):
            result = artemis.audit_code(str(data["code"]), str(data.get("lang") or "text"))
        else:
            result = artemis.audit_path(str(self.cfg.workspace), str(data.get("path") or "."))
        self._send_json(HTTPStatus.OK, result)

    # ---------------- static UI ----------------

    def _static(self, path: str) -> None:
        if not self.cfg.serve_ui:
            raise ApiError(HTTPStatus.NOT_FOUND, "not_found", "واجهة الويب معطّلة على هذا الجسر")
        web_root = Path(self.cfg.web_root)
        if not web_root.is_dir():
            raise ApiError(HTTPStatus.NOT_FOUND, "not_found", "مجلد الواجهة غير موجود")

        relative = path.lstrip("/") or "index.html"
        if relative.endswith("/"):
            relative += "index.html"
        try:
            target = bridge_policy.safe_join(str(web_root), relative)
        except bridge_policy.PolicyError as err:
            raise ApiError(HTTPStatus.FORBIDDEN, "forbidden", str(err))

        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            raise ApiError(HTTPStatus.NOT_FOUND, "not_found", "غير موجود")

        suffix = os.path.splitext(target)[1].lower()
        content_type = CONTENT_TYPES.get(suffix, "application/octet-stream")
        with open(target, "rb") as handle:
            body = handle.read()

        if suffix == ".html" and self.cfg.auth_required and self.cfg.token and self._is_loopback():
            text = body.decode("utf-8", errors="replace")
            meta = f'<meta name="qaswara-bridge-token" content="{html_module.escape(self.cfg.token, quote=True)}" />'

            text = text.replace("</head>", f"  {meta}\n</head>", 1)
            body = text.encode("utf-8")

        cache = "no-store" if suffix in (".html", ".webmanifest", ".js", ".css") else "public, max-age=3600"
        self._send_bytes(
            HTTPStatus.OK,
            body,
            content_type,
            {
                "Cache-Control": cache,
                "Content-Security-Policy": (
                    "default-src 'self'; "
                    "connect-src 'self' http://127.0.0.1:* http://localhost:* https://*; "
                    "img-src 'self' data: blob:; media-src 'self' data: blob:; "
                    # Inline styles/scripts are required by the sandboxed Live Canvas
                    # preview (srcdoc). Markdown rendering escapes all user HTML, so
                    # this does not enable injection into the app shell itself.
                    "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
                    "object-src 'none'; base-uri 'none'"
                ),
            },
        )


# --------------------------------------------------------------------------- #
# factory / CLI                                                               #
# --------------------------------------------------------------------------- #


def create_server(cfg: Config) -> QaswaraServer:
    cfg.prepare()
    return QaswaraServer((cfg.host, cfg.port), Handler, cfg)


def load_or_create_token(path: Path) -> str:
    path = Path(path)
    try:
        if path.is_file():
            token = path.read_text(encoding="utf-8").strip()
            if token:
                return token
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return token


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.2)
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qaswara_bridge.py", description="QASWARA local bridge.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--workspace", default=str(default_workspace()))
    parser.add_argument("--state-dir", default=str(Path.home() / ".qaswara"))
    parser.add_argument("--token", default="")
    parser.add_argument("--no-auth", action="store_true", help="desktop dev only")
    parser.add_argument("--allow-dangerous", action="store_true")
    parser.add_argument("--allow-any-install", action="store_true", help="disable the installer allow-list")
    parser.add_argument("--offline", action="store_true", help="refuse network-touching commands")
    parser.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN")
    parser.add_argument("--allow-file-origin", action="store_true")
    parser.add_argument("--no-ui", action="store_true")
    parser.add_argument("--web-root", default=str(BRIDGE_DIR.parent / "web"))
    parser.add_argument("--print-token", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = Config(
        host=args.host,
        port=args.port,
        workspace=Path(args.workspace),
        state_dir=Path(args.state_dir),
        auth_required=not args.no_auth,
        allow_dangerous=args.allow_dangerous,
        allow_any_install=args.allow_any_install,
        offline=args.offline,
        allow_origins=tuple(args.allow_origin or ()),
        allow_file_origin=args.allow_file_origin,
        serve_ui=not args.no_ui,
        web_root=Path(args.web_root),
        verbose=args.verbose,
    )

    if args.print_token:
        print(args.token or load_or_create_token(cfg.state_dir / "bridge_token"))
        return 0

    if cfg.auth_required:
        cfg.token = args.token or load_or_create_token(cfg.state_dir / "bridge_token")

    try:
        server = create_server(cfg)
    except OSError as err:
        print(f"✖ تعذّر تشغيل الجسر على {cfg.host}:{cfg.port} — {err}", file=sys.stderr)
        print("  جرّب منفذاً آخر: --port 8090", file=sys.stderr)
        return 1

    banner = [
        "",
        "  ╔══════════════════════════════════════════════════════════╗",
        "  ║   Q A S W A R A   ·   B R I D G E   v" + VERSION + "            ║",
        "  ╚══════════════════════════════════════════════════════════╝",
        f"  الواجهة :  http://{cfg.host}:{cfg.port}/",
        f"  الصحة  :  http://{cfg.host}:{cfg.port}/health",
        f"  مساحة  :  {cfg.workspace}",
        f"  الذاكرة:  {cfg.state_dir / 'memory.db'}" + ("  (FTS5 ✓)" if server.memory.fts else "  (LIKE)"),
        f"  الصدفة :  {server.executor.bash}",
    ]
    if cfg.auth_required:
        banner += [f"  الرمز   :  {cfg.token}", "  انسخ الرمز إلى الإعدادات أو افتح الواجهة من هذا العنوان."]
    else:
        banner.append("  ⚠️  المصادقة معطّلة (--no-auth) — للجهاز الشخصي فقط.")
    if cfg.allow_dangerous:
        banner.append("  ⚠️  قائمة الحظر معطّلة (--allow-dangerous).")
    if cfg.offline:
        banner.append("  🔌 قاطع الإنترنت على الجسر مفعّل: أوامر الشبكة مرفوضة.")
    if cfg.host not in ("127.0.0.1", "localhost", "::1"):
        banner.append(f"  ⚠️  الجسر مفتوح على الشبكة ({cfg.host} / {local_ip()}).")
    banner.append("")
    print("\n".join(banner), flush=True)

    def shutdown(signum, frame):  # noqa: ARG001
        print("\n… إيقاف قسورة", flush=True)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever(poll_interval=0.4)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

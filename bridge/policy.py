"""
QASWARA — bridge-side policy.

Three independent guards, because a prompt-injected model must not be trusted:

1. Command deny-list   → catastrophic shell commands never run.
2. Installer allow-list → only known tool names, never a shell fragment.
3. Workspace confinement → file APIs cannot leave the workspace.
4. Offline mode        → network-touching commands are refused.

Pure Python, stdlib only, unit-tested in tests/test_policy.py.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Iterable, List, Optional

ALLOWED_LANGS = ("bash", "sh", "python", "python3", "node")
DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 600
MAX_CODE_BYTES = 200_000


class PolicyError(ValueError):
    """Raised when a request is structurally invalid or escapes the workspace."""


@dataclass(frozen=True)
class Rule:
    level: str
    pattern: re.Pattern
    reason: str


CRITICAL_RULES: tuple[Rule, ...] = (
    Rule(
        "critical",
        re.compile(r"\brm\s+(-[A-Za-z]+\s+)*-[A-Za-z]*[rR][A-Za-z]*f?[A-Za-z]*\s+(\/|\/\*|~|\$HOME)\s*(;|&|\||$)"),
        "حذف جذري لمجلد النظام أو مجلد المستخدم",
    ),
    Rule(
        "critical",
        re.compile(
            r"\brm\s+(-[A-Za-z]+\s+)*-[A-Za-z]*[rR][A-Za-z]*f?[A-Za-z]*\s+"
            r"/(data|system|vendor|product|storage|sdcard|etc|usr|bin|boot|dev|sdcard/Qaswara_Workspace)\s*(;|&|\||$)"
        ),
        "حذف جذري لقسم نظام/بيانات الهاتف",
    ),
    Rule("critical", re.compile(r"\bmkfs(\.[a-z0-9]+)?\b"), "تهيئة قرص/قسم"),
    Rule("critical", re.compile(r"\bdd\b[^\n]*\bof=/dev/(block|sd|mmcblk)"), "كتابة مباشرة على أقسام الجهاز"),
    Rule("critical", re.compile(r":\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:"), "fork bomb"),
    Rule("critical", re.compile(r"\b(shutdown|reboot|poweroff|halt)\b"), "إطفاء/إعادة تشغيل الجهاز"),
    Rule("critical", re.compile(r"\bsu\b(\s+-c)?\s*$"), "تصعيد صلاحيات الجذر"),
    Rule("critical", re.compile(r"\bchmod\s+(-R\s+)?(777|666)\s+/(\s|$)"), "فتح صلاحيات جذر النظام"),
    Rule("critical", re.compile(r"\bpm\s+(uninstall|clear)\b"), "حذف تطبيق أو مسح بياناته"),
    Rule("critical", re.compile(r"\bsettings\s+put\s+(secure|global)\b"), "تعديل إعدادات النظام المحمية"),
    Rule("critical", re.compile(r">\s*/(system|vendor|product|data/adb)\b"), "الكتابة على قسم النظام"),
    Rule("critical", re.compile(r"\b(iptables|nft)\b"), "تعديل جدار الحماية"),
    Rule("critical", re.compile(r"\b(pkill|killall)\b[^\n]*qaswara_bridge"), "محاولة إيقاف الجسر نفسه"),
    Rule("critical", re.compile(r"\brm\b[^\n]*qaswara_workspace[^\n]*\*"), "مسح مساحة عمل قسورة بالكامل"),
)

#: Network-capable commands, used when the bridge runs with --offline.
NETWORK_RULES: tuple[Rule, ...] = (
    Rule("network", re.compile(r"\b(curl|wget|ssh|scp|sftp|rsync|telnet|nc|ncat|socat)\b"), "أمر شبكي"),
    Rule("network", re.compile(r"\bgit\s+(clone|fetch|pull|push|remote)\b"), "أمر Git شبكي"),
    Rule("network", re.compile(r"\b(pip3?|pipx)\s+(install|download)\b"), "تثبيت حزم من الشبكة"),
    Rule("network", re.compile(r"\b(pkg|apt|apt-get|npm|npx|yarn|pnpm)\s+(install|update|upgrade|add|i)\b"), "تثبيت حزم من الشبكة"),
    Rule("network", re.compile(r"\bpython3?\b[^\n]*\b(urlopen|requests\.|httpx\.|socket\.)\b"), "اتصال شبكي من Python"),
    Rule("network", re.compile(r"\bnode\b[^\n]*require\(['\"](https?|net|dgram|tls)['\"]\)"), "اتصال شبكي من Node"),
)

#: Tools QASWARA is allowed to install on its own. Names only — no flags,
#: no paths, no shell metacharacters (validated separately).
PKG_ALLOWLIST = {
    "ffmpeg", "ffprobe", "tesseract", "poppler", "imagemagick", "jq", "git",
    "curl", "wget", "termux-api", "termux-tools", "nodejs", "openssl",
    "python", "python-pip", "sqlite", "zip", "unzip", "espeak", "espeak-ng",
    "termux-am", "bc", "coreutils", "tar", "vim", "nano", "less", "which",
}
PIP_ALLOWLIST = {
    "pypdf", "openpyxl", "python-docx", "docx2txt", "pillow", "numpy",
    "pandas", "reportlab", "matplotlib", "arabic-reshaper", "python-bidi",
    "requests", "beautifulsoup4", "lxml", "xlsxwriter", "youtube-transcript-api",
}
PACKAGE_RE = re.compile(r"^[a-z0-9][a-z0-9._+-]{0,63}$")


@dataclass
class Verdict:
    allowed: bool
    reasons: List[str]

    def as_dict(self) -> dict:
        return {"allowed": self.allowed, "reasons": self.reasons}


def assess(code: str, allow_dangerous: bool = False) -> Verdict:
    if not isinstance(code, str):
        raise PolicyError("code must be a string")
    if not code.strip():
        raise PolicyError("code is empty")
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise PolicyError("code is too large (limit 200 KB)")
    if allow_dangerous:
        return Verdict(True, [])
    reasons = [rule.reason for rule in CRITICAL_RULES if rule.pattern.search(code)]
    return Verdict(not reasons, reasons)


def assess_network(code: str) -> Verdict:
    """Used only in --offline mode."""
    reasons = [rule.reason for rule in NETWORK_RULES if rule.pattern.search(code)]
    return Verdict(not reasons, reasons)


def validate_install(manager: str, name: str, allow_any: bool = False) -> str:
    """Return the normalised package name or raise PolicyError."""
    manager = (manager or "pkg").strip().lower()
    if manager not in ("pkg", "pip"):
        raise PolicyError("المدير المدعوم: pkg أو pip فقط")
    raw = (name or "").strip().lower()
    if not PACKAGE_RE.match(raw):
        raise PolicyError("اسم حزمة غير صالح (حروف/أرقام/نقاط فقط)")
    if allow_any:
        return raw
    allow = PKG_ALLOWLIST if manager == "pkg" else PIP_ALLOWLIST
    if raw not in allow:
        raise PolicyError(
            f"الحزمة «{raw}» ليست في قائمة التثبيت المسموحة. "
            f"استخدم مدير الحزم يدوياً في Termux أو أضفها إلى policy.py."
        )
    return raw


def clamp_timeout(value, maximum: int = MAX_TIMEOUT) -> int:
    try:
        timeout = int(float(value))
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT
    if timeout <= 0:
        return DEFAULT_TIMEOUT
    return max(1, min(timeout, maximum))


def validate_lang(lang: str) -> str:
    value = (lang or "bash").strip().lower()
    if value not in ALLOWED_LANGS:
        raise PolicyError(f"unsupported lang: {value}")
    return value


def safe_join(root: str, user_path: str) -> str:
    """Resolve within root; reject absolute, `~`, `..` escapes and symlink hops."""
    if user_path is None or str(user_path).strip() == "":
        user_path = "."
    raw = str(user_path)
    if "\x00" in raw:
        raise PolicyError("مسار يحتوي محرفاً غير صالح")
    if os.path.isabs(raw):
        raise PolicyError("المسارات المطلقة غير مسموحة؛ استخدم مساراً نسبياً داخل مساحة العمل")
    if raw.startswith("~"):
        raise PolicyError("لا يُسمح بـ ~ داخل المسارات؛ استخدم مساراً نسبياً داخل مساحة العمل")

    root_real = os.path.realpath(root)
    candidate = os.path.realpath(os.path.join(root_real, raw))
    if candidate != root_real and not candidate.startswith(root_real + os.sep):
        raise PolicyError("المسار خارج مساحة عمل الجسر")

    link = os.path.join(root_real, raw)
    if os.path.islink(link):
        target = os.path.realpath(link)
        if target != root_real and not target.startswith(root_real + os.sep):
            raise PolicyError("رابط رمزي يشير خارج مساحة العمل")
    return candidate


def scrub_env(env: dict) -> dict:
    markers: Iterable[str] = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "COOKIE")
    return {k: v for k, v in env.items() if not any(m in k.upper() for m in markers)}


def validate_phone_number(number: str) -> str:
    """Strict E.164-ish validation so a contact name can never inject shell."""
    value = re.sub(r"[\s\-()]", "", str(number or ""))
    if not re.fullmatch(r"\+?[0-9]{5,16}", value):
        raise PolicyError("رقم هاتف غير صالح (أرقام فقط، ٥–١٦ خانة، + اختياري)")
    return value


def clean_text(value: str, maximum: int = 2000) -> str:
    text = str(value or "").replace("\x00", " ").strip()
    if len(text) > maximum:
        text = text[:maximum]
    return text


def resolve_optional(value: Optional[str]) -> Optional[str]:
    return value if value not in (None, "", "None") else None

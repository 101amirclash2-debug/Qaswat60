"""
QASWARA — Artemis self-auditor.

Static review the agent can run on its own output *before* presenting it:
syntax validity, hard-coded secrets, and the injection/deserialisation patterns
that actually cause incidents. It is deliberately conservative: every finding
is explainable, and severity is explicit so the agent knows what must be fixed.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from typing import Dict, List, Optional

SECRET_RULES = (
    ("critical", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"), "Google API key مكتوب في الكود"),
    ("critical", re.compile(r"\bsk-(?!ant)[A-Za-z0-9_-]{20,}"), "مفتاح OpenAI/Groq مكتوب في الكود"),
    ("critical", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}"), "مفتاح Anthropic مكتوب في الكود"),
    ("critical", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "مفتاح خاص مضمّن"),
    ("critical", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "رمز GitHub مضمّن"),
    ("high", re.compile(r"(?i)\b(password|passwd|secret|api[_-]?key)\s*[:=]\s*['\"][^'\"]{6,}['\"]"),
     "كلمة مرور/مفتاح ثابت في الكود"),
)

CODE_RULES = (
    ("high", re.compile(r"\beval\s*\("), "استخدام eval — تنفيذ كود غير موثوق"),
    ("high", re.compile(r"new\s+Function\s*\("), "new Function — تنفيذ كود ديناميكي"),
    ("high", re.compile(r"\.innerHTML\s*=\s*(?!['\"`])"), "إسناد innerHTML من متغير — خطر XSS"),
    ("high", re.compile(r"dangerouslySetInnerHTML"), "dangerouslySetInnerHTML"),
    ("high", re.compile(r"subprocess\.(run|Popen|call)\([^)]*shell\s*=\s*True"), "subprocess مع shell=True"),
    ("high", re.compile(r"\bos\.system\s*\("), "os.system — حقن أوامر محتمل"),
    ("high", re.compile(r"\bexec\s*\(\s*(input|request|data|payload)"), "exec() على مدخل خارجي"),
    ("high", re.compile(r"pickle\.loads\s*\("), "pickle.loads على بيانات غير موثوقة"),
    ("medium", re.compile(r"yaml\.load\s*\((?![^)]*Loader)"), "yaml.load بدون SafeLoader"),
    ("medium", re.compile(r"verify\s*=\s*False"), "تعطيل التحقق من شهادة TLS"),
    ("medium", re.compile(r"chmod\s+777"), "صلاحيات 777"),
    ("medium", re.compile(r"SELECT\s+.+\s+FROM\s+.+\+\s*", re.I), "SQL مبني بجمع نصوص"),
    ("low", re.compile(r"\bconsole\.log\("), "console.log متروك (قد يكشف بيانات)"),
    ("low", re.compile(r"\bTODO\b|\bFIXME\b"), "TODO/FIXME متروك"),
)

LANG_BY_EXT = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".sh": "bash",
    ".bash": "bash",
}

LANG_BY_NAME = {
    "python": "python",
    "py": "python",
    "javascript": "javascript",
    "js": "javascript",
    "node": "javascript",
    "bash": "bash",
    "sh": "bash",
}


def _syntax_check(code: str, lang: str) -> Optional[Dict[str, str]]:
    """Return a finding when the code does not even parse."""
    lang = LANG_BY_NAME.get(lang, lang)
    tmp = tempfile.NamedTemporaryFile("w", suffix={"python": ".py", "javascript": ".mjs", "bash": ".sh"}.get(lang, ".txt"),
                                      delete=False, encoding="utf-8")
    try:
        tmp.write(code)
        tmp.close()
        if lang == "python":
            proc = subprocess.run(["python3", "-m", "py_compile", tmp.name], capture_output=True, text=True, timeout=60)
        elif lang == "javascript" and shutil.which("node"):
            proc = subprocess.run(["node", "--check", tmp.name], capture_output=True, text=True, timeout=60)
        elif lang == "bash" and shutil.which("bash"):
            proc = subprocess.run(["bash", "-n", tmp.name], capture_output=True, text=True, timeout=60)
        else:
            return None
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip().splitlines()
            return {
                "severity": "critical",
                "rule": "syntax",
                "message": f"خطأ نحوي: {detail[0][:300] if detail else 'غير معروف'}",
            }
        return None
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def audit_code(code: str, lang: str = "text") -> Dict[str, object]:
    findings: List[Dict[str, object]] = []
    text = str(code or "")
    if not text.strip():
        return {"ok": False, "score": 0, "findings": [{"severity": "critical", "rule": "empty", "message": "لا كود للمراجعة"}]}

    syntax = _syntax_check(text, lang)
    if syntax:
        findings.append(syntax)

    lines = text.splitlines()
    for line_no, line in enumerate(lines, start=1):
        for severity, pattern, message in SECRET_RULES + CODE_RULES:
            if pattern.search(line):
                findings.append(
                    {
                        "severity": severity,
                        "rule": message,
                        "line": line_no,
                        "excerpt": line.strip()[:160],
                    }
                )

    weight = {"critical": 40, "high": 15, "medium": 6, "low": 2}
    penalty = sum(weight.get(f["severity"], 3) for f in findings)
    score = max(0, 100 - penalty)
    blockers = [f for f in findings if f["severity"] == "critical"]
    return {
        "ok": not blockers,
        "score": score,
        "findings": findings[:80],
        "critical": len(blockers),
        "high": len([f for f in findings if f["severity"] == "high"]),
        "summary": (
            "لا ملاحظات — الكود يجتاز تدقيق Artemis."
            if not findings
            else f"{len(findings)} ملاحظة ({len(blockers)} حرجة، "
                 f"{len([f for f in findings if f['severity'] == 'high'])} عالية)."
        ),
    }


def audit_path(root: str, relative: str = ".") -> Dict[str, object]:
    """Audit every code file under `relative` (max 60 files)."""
    base = os.path.realpath(root)
    target = os.path.realpath(os.path.join(base, relative))
    if target != base and not target.startswith(base + os.sep):
        raise ValueError("المسار خارج مساحة العمل")

    results = []
    count = 0
    for dirpath, _dirnames, filenames in os.walk(target):
        if count >= 60:
            break
        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in LANG_BY_EXT:
                continue
            path = os.path.join(dirpath, filename)
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as handle:
                    code = handle.read(300_000)
            except OSError:
                continue
            report = audit_code(code, LANG_BY_EXT[ext])
            results.append({"file": os.path.relpath(path, base), **report})
            count += 1
            if count >= 60:
                break

    worst = min((r["score"] for r in results), default=100)
    total = sum(len(r["findings"]) for r in results)
    return {
        "ok": all(r["ok"] for r in results),
        "files": len(results),
        "findings": total,
        "score": worst,
        "summary": f"فحص {len(results)} ملفاً، {total} ملاحظة، أدنى درجة {worst}/100.",
        "results": results[:40],
    }

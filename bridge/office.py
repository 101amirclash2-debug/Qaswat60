"""
QASWARA — office & document engine (mostly stdlib).

Creation
    xlsx / docx / csv / md / html / zip  → stdlib only, always available
    rtf                                  → stdlib only, Arabic-safe fallback
    pdf                                  → needs reportlab (+ arabic-reshaper &
                                           python-bidi for correct Arabic shaping);
                                           the agent can install them automatically

Extraction
    txt/md/csv/json/code                 → direct
    docx / xlsx                          → zip + OOXML parsing (stdlib)
    pdf                                  → pdftotext (poppler) or pypdf
    images                               → tesseract OCR (ara+eng)
    audio/video                          → not extracted here: send the file to a
                                           multimodal model instead (see README)
"""

from __future__ import annotations

import csv
import html
import io
import json
import os
import re
import shutil
import subprocess
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape as xml_escape

TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".toml",
    ".ini", ".log", ".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".java", ".kt",
    ".c", ".h", ".cpp", ".rs", ".go", ".rb", ".php", ".sql", ".sh", ".bash",
    ".html", ".htm", ".css", ".xml", ".svg", ".env", ".gitignore", ".gradle",
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
MEDIA_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".opus", ".flac", ".mp4", ".mkv", ".webm", ".3gp"}
OFFICE_KINDS = {"pdf", "xlsx", "docx", "csv", "md", "html", "zip", "rtf"}
MAX_EXTRACT_CHARS = 400_000


class OfficeError(RuntimeError):
    def __init__(self, message: str, *, code: str = "office_error", install: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.install = install or {}


# --------------------------------------------------------------------------- #
# helpers                                                                     #
# --------------------------------------------------------------------------- #


def _col(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    try:
        float(str(value))
        return True
    except (TypeError, ValueError):
        return False


def _cell_xml(ref: str, value: Any) -> str:
    if value is None or value == "":
        return ""
    if _is_number(value):
        return f'<c r="{ref}"><v>{xml_escape(str(value))}</v></c>'
    text = str(value)
    space = ' xml:space="preserve"' if text != text.strip() else ""
    return f'<c r="{ref}" t="inlineStr"><is><t{space}>{xml_escape(text)}</t></is></c>'


def normalize_payload(payload: Optional[dict]) -> Dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    title = str(data.get("title") or data.get("name") or "قسورة").strip()[:200]
    sections: List[Dict[str, Any]] = []
    for item in data.get("sections") or []:
        if isinstance(item, str):
            sections.append({"heading": "", "body": [item], "bullets": []})
        elif isinstance(item, dict):
            body = item.get("body") or item.get("paragraphs") or item.get("text") or ""
            if isinstance(body, str):
                body = [p for p in body.split("\n") if p.strip()]
            bullets = item.get("bullets") or []
            sections.append(
                {
                    "heading": str(item.get("heading") or "").strip(),
                    "body": [str(p) for p in body if str(p).strip()],
                    "bullets": [str(b) for b in bullets if str(b).strip()],
                }
            )
    if not sections and data.get("text"):
        sections = [{"heading": "", "body": [p for p in str(data["text"]).split("\n") if p.strip()], "bullets": []}]
    rows = data.get("rows") or []
    if rows and not all(isinstance(r, (list, tuple)) for r in rows):
        rows = [[r] for r in rows]
    return {
        "title": title,
        "subtitle": str(data.get("subtitle") or "").strip(),
        "sections": sections,
        "rows": [list(r) for r in rows],
        "sheet_name": re.sub(r"[^\w\u0600-\u06FF]", " ", str(data.get("sheetName") or "QASWARA"))[:28] or "QASWARA",
        "files": data.get("files") if isinstance(data.get("files"), dict) else {},
        "meta": {k: data[k] for k in ("author", "date") if data.get(k)},
    }


def _has_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text or ""))


# --------------------------------------------------------------------------- #
# creation                                                                    #
# --------------------------------------------------------------------------- #


def write_xlsx(path: str, payload: dict) -> Dict[str, Any]:
    norm = normalize_payload(payload)
    rows = norm["rows"] or [[s["heading"] or norm["title"], ""] for s in norm["sections"]]
    if not rows:
        rows = [["لا بيانات"]]
    width = max(len(r) for r in rows)

    sheet_rows = []
    for r_idx, row in enumerate(rows, start=1):
        cells = "".join(_cell_xml(f"{_col(c_idx)}{r_idx}", value) for c_idx, value in enumerate(row))
        sheet_rows.append(f'<row r="{r_idx}">{cells}</row>')
    last_ref = f"{_col(width - 1)}{len(rows)}"

    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="A1:{last_ref}"/>'
        '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>'
        '<sheetFormatPr defaultRowHeight="18"/>'
        f'<sheetData>{"".join(sheet_rows)}</sheetData>'
        "</worksheet>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{xml_escape(norm["sheet_name"])}" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return {"ok": True, "path": path, "kind": "xlsx", "bytes": os.path.getsize(path), "rows": len(rows)}


def _docx_paragraph(text: str, style: Optional[str] = None, bullet: bool = False) -> str:
    props = []
    if style:
        props.append(f'<w:pStyle w:val="{style}"/>')
    if _has_arabic(text):
        props.append("<w:bidi/>")
    ppr = f"<w:pPr>{''.join(props)}</w:pPr>" if props else ""
    prefix = "• " if bullet else ""
    return (
        f"<w:p>{ppr}<w:r><w:rPr>"
        f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
        f'{"<w:rtl/>" if _has_arabic(text) else ""}'
        f"</w:rPr><w:t xml:space=\"preserve\">{xml_escape(prefix + text)}</w:t></w:r></w:p>"
    )


def write_docx(path: str, payload: dict) -> Dict[str, Any]:
    norm = normalize_payload(payload)
    parts = [
        _docx_paragraph(norm["title"], style="Title"),
        *([_docx_paragraph(norm["subtitle"], style="Subtitle")] if norm["subtitle"] else []),
    ]
    for section in norm["sections"]:
        if section["heading"]:
            parts.append(_docx_paragraph(section["heading"], style="Heading1"))
        for paragraph in section["body"]:
            parts.append(_docx_paragraph(paragraph))
        for bullet in section["bullets"]:
            parts.append(_docx_paragraph(bullet, bullet=True))
    if norm["rows"]:
        parts.append(_docx_paragraph("جدول البيانات", style="Heading2"))
        for row in norm["rows"]:
            parts.append(_docx_paragraph(" | ".join(str(c) for c in row)))

    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(parts)}"
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        "</w:body></w:document>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
        '<w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
        "</w:styles>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
    )
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("word/document.xml", document)
        zf.writestr("word/styles.xml", styles)
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
    return {"ok": True, "path": path, "kind": "docx", "bytes": os.path.getsize(path)}


def write_csv(path: str, payload: dict) -> Dict[str, Any]:
    norm = normalize_payload(payload)
    rows = norm["rows"] or [[norm["title"]], *[s["body"] for s in norm["sections"] if s["body"]]]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    # utf-8-sig so Excel on Android/Windows detects Arabic correctly
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        for row in rows:
            writer.writerow(["" if cell is None else str(cell) for cell in row])
    return {"ok": True, "path": path, "kind": "csv", "bytes": os.path.getsize(path)}


def write_markdown(path: str, payload: dict) -> Dict[str, Any]:
    norm = normalize_payload(payload)
    lines = [f"# {norm['title']}", ""]
    if norm["subtitle"]:
        lines += [f"_{norm['subtitle']}_", ""]
    for section in norm["sections"]:
        if section["heading"]:
            lines += [f"## {section['heading']}", ""]
        for paragraph in section["body"]:
            lines += [paragraph, ""]
        if section["bullets"]:
            lines += [f"- {b}" for b in section["bullets"]] + [""]
    if norm["rows"]:
        width = max(len(r) for r in norm["rows"])
        header = [str(c) for c in norm["rows"][0]]
        lines.append("| " + " | ".join(header + [""] * (width - len(header))) + " |")
        lines.append("|" + "---|" * width)
        for row in norm["rows"][1:]:
            cells = [str(c) for c in row] + [""] * (width - len(row))
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines).rstrip() + "\n")
    return {"ok": True, "path": path, "kind": "md", "bytes": os.path.getsize(path)}


def write_html(path: str, payload: dict) -> Dict[str, Any]:
    norm = normalize_payload(payload)
    body = [f"<h1>{html.escape(norm['title'])}</h1>"]
    if norm["subtitle"]:
        body.append(f'<p class="sub">{html.escape(norm["subtitle"])}</p>')
    for section in norm["sections"]:
        if section["heading"]:
            body.append(f"<h2>{html.escape(section['heading'])}</h2>")
        for paragraph in section["body"]:
            body.append(f"<p>{html.escape(paragraph)}</p>")
        if section["bullets"]:
            body.append("<ul>" + "".join(f"<li>{html.escape(b)}</li>" for b in section["bullets"]) + "</ul>")
    if norm["rows"]:
        head, *rest = norm["rows"]
        body.append(
            "<table><thead><tr>"
            + "".join(f"<th>{html.escape(str(c))}</th>" for c in head)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in row) + "</tr>" for row in rest)
            + "</tbody></table>"
        )
    document = (
        "<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\">"
        f"<title>{html.escape(norm['title'])}</title>"
        "<style>body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.9;color:#122}"
        "h1{border-bottom:2px solid #0b7d55;padding-bottom:8px}.sub{color:#666}"
        "table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #ccc;padding:8px;text-align:right}"
        "th{background:#eef7f2}</style></head><body>" + "".join(body) + "</body></html>"
    )
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(document)
    return {"ok": True, "path": path, "kind": "html", "bytes": os.path.getsize(path)}


def write_rtf(path: str, payload: dict) -> Dict[str, Any]:
    """Arabic-safe RTF fallback that opens in any word processor."""
    norm = normalize_payload(payload)

    def rtf_text(text: str) -> str:
        out = []
        for ch in text:
            code = ord(ch)
            if ch in "\\{}":
                out.append("\\" + ch)
            elif code < 128:
                out.append(ch)
            else:
                out.append(f"\\u{code}?")
        return "".join(out)

    blocks = [f"\\pard\\qc\\b\\fs40 {rtf_text(norm['title'])}\\b0\\par"]
    for section in norm["sections"]:
        if section["heading"]:
            blocks.append(f"\\pard\\b\\fs28 {rtf_text(section['heading'])}\\b0\\par")
        for paragraph in section["body"]:
            blocks.append(f"\\pard\\qj {rtf_text(paragraph)}\\par")
        for bullet in section["bullets"]:
            blocks.append(f"\\pard\\qj • {rtf_text(bullet)}\\par")
    for row in norm["rows"]:
        blocks.append("\\pard " + rtf_text(" | ".join(str(c) for c in row)) + "\\par")
    rtf = r"{\rtf1\ansi\ansicpg1256\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 " + "".join(blocks) + "}"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="ascii", errors="replace") as handle:
        handle.write(rtf)
    return {"ok": True, "path": path, "kind": "rtf", "bytes": os.path.getsize(path)}


def write_zip(path: str, payload: dict) -> Dict[str, Any]:
    norm = normalize_payload(payload)
    files = norm["files"]
    if not files:
        raise OfficeError("لا ملفات لتجميعها (مرّر files: {الاسم: المحتوى})", code="bad_payload")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            safe = str(name).replace("..", "_").lstrip("/")
            if isinstance(content, (dict, list)):
                content = json.dumps(content, ensure_ascii=False, indent=2)
            zf.writestr(safe, str(content))
    return {"ok": True, "path": path, "kind": "zip", "bytes": os.path.getsize(path), "files": len(files)}


def write_pdf(path: str, payload: dict) -> Dict[str, Any]:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except ImportError as err:  # pragma: no cover - depends on the device
        raise OfficeError(
            "إنشاء PDF يحتاج مكتبات Python غير المثبّتة بعد.",
            code="missing_dependency",
            install={"manager": "pip", "packages": ["reportlab", "arabic-reshaper", "python-bidi"], "reason": str(err)},
        )

    try:  # optional Arabic shaping
        import arabic_reshaper
        from bidi.algorithm import get_display

        def shape(text: str) -> str:
            return get_display(arabic_reshaper.reshape(text)) if _has_arabic(text) else text
    except ImportError:
        def shape(text: str) -> str:  # type: ignore[misc]
            return text

    font_name = "Helvetica"
    for candidate in (
        "/system/fonts/DroidSansArabic.ttf",
        "/system/fonts/NotoSansArabic-Regular.ttf",
        "/system/fonts/Roboto-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.isfile(candidate):
            try:
                pdfmetrics.registerFont(TTFont("QaswaraFont", candidate))
                font_name = "QaswaraFont"
                break
            except Exception:  # pragma: no cover
                continue

    norm = normalize_payload(payload)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("QTitle", parent=styles["Title"], fontName=font_name, fontSize=20, leading=26)
    heading_style = ParagraphStyle("QHeading", parent=styles["Heading2"], fontName=font_name, fontSize=14, leading=20)
    body_style = ParagraphStyle("QBody", parent=styles["BodyText"], fontName=font_name, fontSize=11, leading=18)

    story = [Paragraph(html.escape(shape(norm["title"])), title_style), Spacer(1, 0.4 * cm)]
    if norm["subtitle"]:
        story += [Paragraph(html.escape(shape(norm["subtitle"])), body_style), Spacer(1, 0.4 * cm)]
    for section in norm["sections"]:
        if section["heading"]:
            story += [Paragraph(html.escape(shape(section["heading"])), heading_style), Spacer(1, 0.15 * cm)]
        for paragraph in section["body"]:
            story += [Paragraph(html.escape(shape(paragraph)), body_style), Spacer(1, 0.12 * cm)]
        for bullet in section["bullets"]:
            story += [Paragraph("• " + html.escape(shape(bullet)), body_style), Spacer(1, 0.08 * cm)]
    for row in norm["rows"]:
        story += [Paragraph(html.escape(shape(" | ".join(str(c) for c in row))), body_style), Spacer(1, 0.08 * cm)]

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    doc = SimpleDocTemplate(path, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm,
                            leftMargin=2 * cm, rightMargin=2 * cm, title=norm["title"])
    doc.build(story)
    return {"ok": True, "path": path, "kind": "pdf", "bytes": os.path.getsize(path), "font": font_name}


def create(kind: str, path: str, payload: dict) -> Dict[str, Any]:
    kind = (kind or "").strip().lower()
    if kind not in OFFICE_KINDS:
        raise OfficeError(f"نوع غير مدعوم: {kind}. المتاح: {', '.join(sorted(OFFICE_KINDS))}", code="bad_kind")
    writers = {
        "pdf": write_pdf,
        "xlsx": write_xlsx,
        "docx": write_docx,
        "csv": write_csv,
        "md": write_markdown,
        "html": write_html,
        "zip": write_zip,
        "rtf": write_rtf,
    }
    return writers[kind](path, payload)


# --------------------------------------------------------------------------- #
# extraction                                                                  #
# --------------------------------------------------------------------------- #


def _read_text_file(path: str, limit: int) -> Dict[str, Any]:
    with open(path, "rb") as handle:
        raw = handle.read(limit * 4)
    for encoding in ("utf-8", "utf-8-sig", "cp1256", "latin-1"):
        try:
            text = raw.decode(encoding)
            return {"text": text[:limit], "encoding": encoding}
        except UnicodeDecodeError:
            continue
    return {"text": raw.decode("utf-8", errors="replace")[:limit], "encoding": "utf-8?"}


def _docx_text(path: str) -> str:
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n in ("word/document.xml", "word/footnotes.xml")]
        chunks = []
        for name in names:
            xml = zf.read(name).decode("utf-8", errors="replace")
            xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
            xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
            xml = re.sub(r"</w:p>", "\n", xml)
            xml = re.sub(r"<[^>]+>", "", xml)
            chunks.append(html.unescape(xml))
    return "\n".join(chunks)


def _xlsx_text(path: str) -> str:
    with zipfile.ZipFile(path) as zf:
        shared: List[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            xml = zf.read("xl/sharedStrings.xml").decode("utf-8", errors="replace")
            for si in re.findall(r"<si>([\s\S]*?)</si>", xml):
                shared.append(html.unescape("".join(re.findall(r"<t[^>]*>([\s\S]*?)</t>", si))))
        sheets = sorted(n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        lines: List[str] = []
        for sheet in sheets:
            xml = zf.read(sheet).decode("utf-8", errors="replace")
            lines.append(f"### {os.path.basename(sheet)}")
            for row in re.findall(r"<row[^>]*>([\s\S]*?)</row>", xml):
                cells: List[str] = []
                for match in re.finditer(r"<c([^>]*)>([\s\S]*?)</c>", row):
                    attrs, inner = match.group(1), match.group(2)
                    value = re.search(r"<v>([\s\S]*?)</v>", inner)
                    if value is None:
                        value = re.search(r"<t[^>]*>([\s\S]*?)</t>", inner)
                    text = html.unescape(value.group(1)) if value else ""
                    if 't="s"' in attrs and text.isdigit():
                        idx = int(text)
                        text = shared[idx] if idx < len(shared) else text
                    cells.append(text)
                if any(c.strip() for c in cells):
                    lines.append(" | ".join(cells))
        return "\n".join(lines)


def _pdf_text(path: str) -> Dict[str, Any]:
    if shutil.which("pdftotext"):
        proc = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"],
                              capture_output=True, text=True, timeout=120)
        if proc.returncode == 0 and proc.stdout.strip():
            return {"text": proc.stdout, "tool": "pdftotext"}
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(path)
        text = "\n\n".join((page.extract_text() or "") for page in reader.pages[:400])
        return {"text": text, "tool": "pypdf"}
    except ImportError:
        raise OfficeError(
            "استخراج نص PDF يحتاج pdftotext أو pypdf.",
            code="missing_dependency",
            install={"manager": "pkg", "packages": ["poppler"], "alt": {"manager": "pip", "packages": ["pypdf"]}},
        )
    except Exception as err:  # pragma: no cover
        raise OfficeError(f"تعذّر قراءة PDF: {err}", code="extract_failed")


def _ocr(path: str) -> Dict[str, Any]:
    if not shutil.which("tesseract"):
        raise OfficeError(
            "قراءة الصور تحتاج tesseract (OCR).",
            code="missing_dependency",
            install={"manager": "pkg", "packages": ["tesseract"], "reason": "OCR للصور"},
        )
    languages = "ara+eng"
    proc = subprocess.run(["tesseract", path, "stdout", "-l", languages],
                          capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        proc = subprocess.run(["tesseract", path, "stdout"], capture_output=True, text=True, timeout=180)
    return {"text": proc.stdout, "tool": "tesseract", "language": languages}


def extract(path: str, limit: int = MAX_EXTRACT_CHARS) -> Dict[str, Any]:
    if not os.path.isfile(path):
        raise OfficeError(f"الملف غير موجود: {path}", code="not_found")
    ext = os.path.splitext(path)[1].lower()
    note = ""

    if ext == ".docx":
        text, tool = _docx_text(path), "ooxml"
    elif ext in (".xlsx", ".xlsm"):
        text, tool = _xlsx_text(path), "ooxml"
    elif ext == ".pdf":
        result = _pdf_text(path)
        text, tool = result["text"], result["tool"]
    elif ext in IMAGE_EXTS:
        result = _ocr(path)
        text, tool = result["text"], result["tool"]
    elif ext in MEDIA_EXTS:
        return {
            "ok": False,
            "code": "media_binary",
            "path": path,
            "size": os.path.getsize(path),
            "message": "ملف صوت/فيديو: أرسله إلى نموذج متعدد الوسائط (Gemini) بدلاً من استخراج النص.",
        }
    elif ext in TEXT_EXTS or ext == "":
        result = _read_text_file(path, limit)
        text, tool = result["text"], f"text/{result['encoding']}"
    else:
        result = _read_text_file(path, limit)
        text = result["text"]
        tool = f"text/{result['encoding']}"
        if "\x00" in text[:4000]:
            raise OfficeError(f"ملف ثنائي غير مدعوم: {ext}", code="unsupported")

    text = (text or "").strip()
    if not text:
        note = "لم يُستخرج نص (قد يكون الملف صوراً ممسوحة أو محمياً)."
    truncated = len(text) > limit
    return {
        "ok": True,
        "path": path,
        "kind": ext.lstrip(".") or "txt",
        "tool": tool,
        "text": text[:limit],
        "chars": len(text),
        "truncated": truncated,
        "note": note,
    }

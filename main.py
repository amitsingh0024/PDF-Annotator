#!/usr/bin/env python3
"""
PDF Annotation Studio
Lightweight desktop app — PyWebView + pypdfium2
"""

import base64
import hashlib
import io
import json
import os
import time
from pathlib import Path

import pypdfium2 as pdfium
import webview

# ── Paths ──────────────────────────────────────────────────────────────────────

APP_DIR   = Path(__file__).parent
STATIC    = APP_DIR / "static"
DATA_DIR  = Path.home() / ".pdf_annotator"
DATA_DIR.mkdir(exist_ok=True)
PREFS_FILE  = DATA_DIR / "prefs.json"
RECENT_FILE = DATA_DIR / "recent.json"

# ── Module-level state ────────────────────────────────────────────────────────

_page_cache: dict = {}
_current_pdf: pdfium.PdfDocument | None = None
_current_pdf_path: str = ""
_current_pdf_hash: str = ""
_window: webview.Window | None = None   # set after create_window


# ── Helpers ────────────────────────────────────────────────────────────────────

def _file_hash(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def _annotation_path(pdf_path: str) -> Path:
    p = Path(pdf_path)
    return p.with_name(p.stem + "_annotations.json")


def _load_prefs() -> dict:
    if PREFS_FILE.exists():
        try:
            return json.loads(PREFS_FILE.read_text())
        except Exception:
            pass
    return {"theme": "dark", "default_dpi": 150}


def _save_prefs(prefs: dict) -> None:
    PREFS_FILE.write_text(json.dumps(prefs, indent=2))


def _load_recent() -> list:
    if RECENT_FILE.exists():
        try:
            return json.loads(RECENT_FILE.read_text())
        except Exception:
            pass
    return []


def _push_recent(path: str) -> None:
    recent = _load_recent()
    path = str(Path(path).resolve())
    recent = [r for r in recent if r != path]
    recent.insert(0, path)
    RECENT_FILE.write_text(json.dumps(recent[:10], indent=2))


def _default_labels() -> list:
    return [
        {"id": "text",    "name": "Text",    "color": "#22c55e"},
        {"id": "heading", "name": "Heading", "color": "#f59e0b"},
        {"id": "table",   "name": "Table",   "color": "#06b6d4"},
        {"id": "image",   "name": "Image",   "color": "#a78bfa"},
        {"id": "ignore",  "name": "Ignore",  "color": "#ef4444"},
    ]


# ── API exposed to JavaScript ─────────────────────────────────────────────────

class API:

    # ── File dialogs ───────────────────────────────────────────────────────────

    def open_file_dialog(self) -> str | None:
        """Show native open-file dialog; return chosen path or None."""
        result = _window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("PDF Files (*.pdf)",),
        )
        return result[0] if result else None

    def export_dialog(self, default_name: str) -> str | None:
        """Show native save dialog; return chosen path or None."""
        result = _window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=default_name,
            file_types=("JSON Files (*.json)",),
        )
        return result if result else None

    # ── PDF ────────────────────────────────────────────────────────────────────

    def open_pdf(self, path: str) -> dict:
        global _current_pdf, _current_pdf_path, _current_pdf_hash, _page_cache

        path = str(Path(path).resolve())
        if not os.path.exists(path):
            return {"error": f"File not found: {path}"}

        try:
            _current_pdf      = pdfium.PdfDocument(path)
            _current_pdf_path = path
            _current_pdf_hash = _file_hash(path)
            _page_cache.clear()
            _push_recent(path)

            return {
                "path":       path,
                "name":       Path(path).name,
                "hash":       _current_pdf_hash,
                "page_count": len(_current_pdf),
            }
        except Exception as e:
            return {"error": str(e)}

    def get_recent_files(self) -> list:
        return [r for r in _load_recent() if os.path.exists(r)]

    # ── Rendering ──────────────────────────────────────────────────────────────

    def render_page(self, page_index: int, dpi: int = 150) -> dict:
        """Render a page; return base64 JPEG + pixel dimensions."""
        if _current_pdf is None:
            return {"error": "No PDF open"}

        cache_key = (_current_pdf_hash, page_index, dpi)
        if cache_key in _page_cache:
            return _page_cache[cache_key]

        try:
            page    = _current_pdf[page_index]
            bitmap  = page.render(scale=dpi / 72, rotation=0)
            pil_img = bitmap.to_pil()

            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=88)
            b64 = base64.b64encode(buf.getvalue()).decode()

            result = {"image": b64, "width": pil_img.width, "height": pil_img.height}
            _page_cache[cache_key] = result
            return result
        except Exception as e:
            return {"error": str(e)}

    def render_thumbnail(self, page_index: int) -> dict:
        return self.render_page(page_index, dpi=72)

    # ── Annotations ────────────────────────────────────────────────────────────

    def load_annotations(self) -> dict:
        if not _current_pdf_path:
            return {"error": "No PDF open"}

        ann_path = _annotation_path(_current_pdf_path)
        if ann_path.exists():
            try:
                return json.loads(ann_path.read_text(encoding="utf-8"))
            except Exception as e:
                return {"error": str(e)}

        return {
            "pdf":           Path(_current_pdf_path).name,
            "pdf_hash":      _current_pdf_hash,
            "created":       time.strftime("%Y-%m-%dT%H:%M:%S"),
            "last_modified": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "labels":        _default_labels(),
            "pages":         {},
        }

    def save_annotations(self, data: dict) -> dict:
        if not _current_pdf_path:
            return {"error": "No PDF open"}
        try:
            data["last_modified"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            ann_path = _annotation_path(_current_pdf_path)
            ann_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return {"ok": True, "path": str(ann_path)}
        except Exception as e:
            return {"error": str(e)}

    def get_annotation_path(self) -> str:
        if not _current_pdf_path:
            return ""
        return str(_annotation_path(_current_pdf_path))

    # ── Preferences ────────────────────────────────────────────────────────────

    def get_prefs(self) -> dict:
        return _load_prefs()

    def save_prefs(self, prefs: dict) -> dict:
        _save_prefs(prefs)
        return {"ok": True}

    def get_version(self) -> str:
        return "1.0.0"


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    api = API()

    _window = webview.create_window(
        title="PDF Annotation Studio",
        url=str(STATIC / "index.html"),
        js_api=api,
        width=1400,
        height=860,
        min_size=(900, 600),
        background_color="#1a1a1a",
    )

    webview.start(debug=False)

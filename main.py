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
import threading
import time
from pathlib import Path
from PIL import ImageEnhance, ImageFilter

import pypdfium2 as pdfium
import webview

try:
    import pytesseract
    _TESSERACT_OK = True
except ImportError:
    _TESSERACT_OK = False

def _setup_tesseract() -> None:
    """On Windows, find the Tesseract binary via the registry and point
    pytesseract at it so it works even when Tesseract is not on PATH.

    Also sets TESSDATA_PREFIX so Tesseract finds the Hindi/Sanskrit models
    bundled alongside the app executable (installed to {app}\\tessdata\\ by
    the Inno Setup installer)."""
    import platform
    if platform.system() != "Windows":
        return  # macOS / Linux: tesseract is expected to be on PATH

    import sys

    # When running as a PyInstaller single-file bundle, sys.executable is the
    # .exe path; its directory is where Inno Setup copies the tessdata folder.
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
    else:
        exe_dir = Path(__file__).parent

    bundled_tessdata = exe_dir / "tessdata"
    if bundled_tessdata.is_dir():
        # Tesseract 4+ expects TESSDATA_PREFIX to be the folder that directly
        # contains the .traineddata files (i.e. the tessdata/ dir itself).
        os.environ["TESSDATA_PREFIX"] = str(bundled_tessdata)

    import winreg
    candidates: list[str] = []

    for hive, subkey in [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Tesseract-OCR"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Tesseract-OCR"),
    ]:
        try:
            key = winreg.OpenKey(hive, subkey)
            value, _ = winreg.QueryValueEx(key, "InstallDir")
            winreg.CloseKey(key)
            candidates.append(str(value))
        except Exception:
            pass

    # Fallback to known default locations
    candidates += [
        r"C:\Program Files\Tesseract-OCR",
        r"C:\Program Files (x86)\Tesseract-OCR",
    ]

    for d in candidates:
        exe = os.path.join(d, "tesseract.exe")
        if os.path.exists(exe):
            pytesseract.pytesseract.tesseract_cmd = exe
            return

if _TESSERACT_OK:
    _setup_tesseract()

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

_ocr_state: dict = {
    "running":     False,
    "cancel":      False,
    "current":     0,
    "total":       0,
    "status":      "",
    "done":        False,
    "error":       "",
    "result_json": None,
    "result_txt":  None,
}


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
    return {"theme": "dark", "default_dpi": 150, "ocr_lang": "hin+san+eng", "ocr_dpi": 300}


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

    # ── OCR Parse ──────────────────────────────────────────────────────────────

    def get_annotated_pages(self) -> list:
        """Return sorted list of 1-based page numbers that have at least one active (non-ignore) region."""
        if not _current_pdf_path:
            return []
        ann_path = _annotation_path(_current_pdf_path)
        if not ann_path.exists():
            return []
        try:
            ann = json.loads(ann_path.read_text(encoding="utf-8"))
            ignore_ids = {
                lbl["id"] for lbl in ann.get("labels", [])
                if lbl.get("name", "").lower() == "ignore"
            }
            result = []
            for page_key, regions in ann.get("pages", {}).items():
                if any(r.get("label") not in ignore_ids for r in regions):
                    result.append(int(page_key))
            return sorted(result)
        except Exception:
            return []

    def start_ocr_parse(self, pages: list, lang: str, dpi: int = 300) -> dict:
        """Start OCR parsing in a background thread."""
        global _ocr_state
        if not _TESSERACT_OK:
            return {"error": "pytesseract is not installed. Run: pip install pytesseract"}
        if _ocr_state.get("running"):
            return {"error": "OCR already running"}
        if not _current_pdf_path:
            return {"error": "No PDF open"}
        if not pages:
            return {"error": "No pages selected"}

        # Verify every language model requested is actually present before
        # starting the background thread — gives a clear message instead of a
        # cryptic TesseractError mid-parse.
        tess_prefix = os.environ.get("TESSDATA_PREFIX", "")
        if tess_prefix:
            missing = [
                l for l in str(lang).split("+")
                if not os.path.exists(os.path.join(tess_prefix, f"{l}.traineddata"))
            ]
            if missing:
                return {
                    "error": (
                        f"Missing OCR language data: {', '.join(missing)}.traineddata\n"
                        f"Expected location: {tess_prefix}\n"
                        "Please reinstall the app to restore bundled language files."
                    )
                }

        _ocr_state = {
            "running":     True,
            "cancel":      False,
            "current":     0,
            "total":       len(pages),
            "status":      "Starting…",
            "done":        False,
            "error":       "",
            "result_json": None,
            "result_txt":  None,
        }
        t = threading.Thread(
            target=self._ocr_worker,
            args=(list(pages), str(lang), int(dpi)),
            daemon=True,
        )
        t.start()
        return {"ok": True}

    def get_parse_progress(self) -> dict:
        return dict(_ocr_state)

    def cancel_ocr_parse(self) -> dict:
        global _ocr_state
        _ocr_state["cancel"] = True
        return {"ok": True}

    def save_parsed_output(self, content: str, fmt: str) -> dict:
        """Show native Save-As dialog and write the parsed output."""
        if not _current_pdf_path:
            return {"error": "No PDF open"}
        stem = Path(_current_pdf_path).stem
        default_name = stem + "_parsed." + fmt
        file_types = (
            ("Text Files (*.txt)",) if fmt == "txt" else ("JSON Files (*.json)",)
        )
        result = _window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=default_name,
            file_types=file_types,
        )
        if not result:
            return {"cancelled": True}
        save_path = result if isinstance(result, str) else result[0]
        try:
            Path(save_path).write_text(content, encoding="utf-8")
            return {"ok": True, "path": save_path}
        except Exception as e:
            return {"error": str(e)}

    def _ocr_worker(self, pages: list, lang: str, dpi: int = 300) -> None:
        global _ocr_state
        try:
            ann_path = _annotation_path(_current_pdf_path)
            ann      = json.loads(ann_path.read_text(encoding="utf-8"))
            labels   = ann.get("labels", [])
            ann_pages = ann.get("pages", {})

            ignore_ids = {
                lbl["id"] for lbl in labels
                if lbl.get("name", "").lower() == "ignore"
            }
            label_map = {lbl["id"]: lbl["name"] for lbl in labels}

            doc = pdfium.PdfDocument(_current_pdf_path)
            all_pages: dict = {}

            for i, page_num in enumerate(pages):
                if _ocr_state["cancel"]:
                    _ocr_state.update({"status": "Cancelled", "running": False})
                    return

                _ocr_state["current"] = i + 1
                _ocr_state["status"]  = f"Page {page_num} — rendering…"

                page_key = str(page_num)
                regions  = ann_pages.get(page_key, [])
                active   = [r for r in regions if r.get("label") not in ignore_ids]
                chunks: list = []

                if active:
                    bitmap = doc[page_num - 1].render(scale=dpi / 72, rotation=0)
                    img    = bitmap.to_pil()

                    # Preserve the annotation creation order from the JSON file.
                    # Annotations are stored in the order the user drew them, which
                    # is the intended reading sequence — do NOT re-sort spatially,
                    # as that breaks multi-column layouts where two columns share
                    # similar Y coordinates.
                    for r in active:
                        if _ocr_state["cancel"]:
                            _ocr_state.update({"status": "Cancelled", "running": False})
                            return

                        lname = label_map.get(r.get("label", ""), r.get("label", "text"))

                        if "pts" in r:
                            xs = [p["x"] for p in r["pts"]]
                            ys = [p["y"] for p in r["pts"]]
                            x, y = min(xs), min(ys)
                            w, h = max(xs) - x, max(ys) - y
                        else:
                            x, y, w, h = r["x"], r["y"], r["w"], r["h"]

                        iw, ih = img.size
                        crop = img.crop((
                            int(x * iw), int(y * ih),
                            int((x + w) * iw), int((y + h) * ih),
                        ))

                        # ── Pre-process crop for better Devanagari recognition ──
                        # 1. Grayscale — removes colour noise
                        crop = crop.convert("L")
                        # 2. Contrast boost — makes thin strokes crisper
                        crop = ImageEnhance.Contrast(crop).enhance(2.0)
                        # 3. Sharpen — recovers detail lost in rendering
                        crop = crop.filter(ImageFilter.SHARPEN)

                        # PSM 6  = single uniform text block (correct for pre-cropped regions)
                        # OEM 1  = LSTM engine only (best for complex scripts like Devanagari)
                        _ocr_cfg = "--psm 6 --oem 1"

                        _ocr_state["status"] = f"Page {page_num} — OCR [{lname}]…"
                        text = pytesseract.image_to_string(crop, lang=lang, config=_ocr_cfg).strip()

                        if text:
                            chunks.append({
                                "page":   page_num,
                                "label":  lname,
                                "source": "annotated",
                                "text":   text,
                                "note":   r.get("note", ""),
                                "bbox":   {
                                    "x": round(x, 4), "y": round(y, 4),
                                    "w": round(w, 4), "h": round(h, 4),
                                },
                            })

                all_pages[page_key] = chunks

            # ── Build JSON output ──────────────────────────────────────────────
            all_chunks = [c for clist in all_pages.values() for c in clist]
            result_data = {
                "source":       Path(_current_pdf_path).name,
                "lang":         lang,
                "dpi":          dpi,
                "pages_parsed": len(pages),
                "pages":        all_pages,
            }
            result_json = json.dumps(result_data, ensure_ascii=False, indent=2)

            # ── Build TXT output ───────────────────────────────────────────────
            lines = []
            for page_num in pages:
                page_key = str(page_num)
                chunks   = all_pages.get(page_key, [])
                if not chunks:
                    continue
                lines.append("=" * 60)
                lines.append(f"  PAGE {page_num}")
                lines.append("=" * 60)
                lines.append("")
                for c in chunks:
                    lines.append(f"[{c['label'].upper()}]")
                    lines.append(c["text"])
                    lines.append("")
            result_txt = "\n".join(lines)

            _ocr_state.update({
                "result_json": result_json,
                "result_txt":  result_txt,
                "status":      f"Done — {len(all_chunks)} regions from {len(pages)} page(s)",
                "done":        True,
                "running":     False,
            })

        except Exception as e:
            _ocr_state.update({"error": str(e), "running": False, "done": False})


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

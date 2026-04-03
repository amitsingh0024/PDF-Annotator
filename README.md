# PDF Annotation Studio

A lightweight desktop application for annotating PDF documents with labeled regions, and extracting text from those regions using OCR. Built with Python + pywebview — no Electron, no browser, no external server.

---

## Table of Contents

- [Features](#features)
- [Screenshots / Layout](#screenshots--layout)
- [Installation (End Users)](#installation-end-users)
- [Running from Source (Developers)](#running-from-source-developers)
- [Annotation Tools](#annotation-tools)
- [Label System](#label-system)
- [Saving & Persistence](#saving--persistence)
- [Parse PDF (OCR)](#parse-pdf-ocr)
- [Annotation File Format](#annotation-file-format)
- [OCR Output Formats](#ocr-output-formats)
- [Building the Installer](#building-the-installer)
- [GitHub Actions CI](#github-actions-ci)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)
- [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Features

- **Open any PDF** — drag & drop or use the Open button / Ctrl+O
- **Five drawing tools** — Rectangle, Polygon, Freehand lasso, Select/move, Eraser
- **Label system** — assign semantic labels (Text, Heading, Table, Image, Ignore) to each region; add unlimited custom labels with custom colours
- **Persistent annotations** — saved automatically as a JSON file next to the PDF; reloaded every time you reopen that file
- **Auto-save** — changes are written to disk 60 seconds after the last edit, or whenever you switch pages
- **Undo / Redo** — up to 60 states per page (Ctrl+Z / Ctrl+Y)
- **Parse PDF with OCR** — select annotated pages, choose OCR language, export results as plain text and/or structured JSON
- **Light and dark theme** — toggle with T or the sun icon
- **Recent files** — quick access to previously opened PDFs
- **Zoom and pan** — scroll wheel to zoom, Space/middle-click to pan

---

## Screenshots / Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Toolbar: Open · Save · Parse · Select · Rect · Polygon · …    │
├──────────────────────────────────────────────────────────────────┤
│  Label bar: [Text] [Heading] [Table] [Image] [Ignore] [+ Add]  │
├──────────┬────────────────────────────────┬─────────────────────┤
│          │                                │  Sidebar            │
│ Thumb-   │       Canvas (PDF page)        │  ┌ Regions ┬ Labels┐│
│ nail     │       with drawn regions       │  │ region  │ label ││
│ strip    │                                │  │ list    │ mgr   ││
│          │                                │  └─────────┴───────┘│
├──────────┴────────────────────────────────┴─────────────────────┤
│  Status bar: Tool · Page · Zoom · Regions · Cursor              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Installation (End Users)

### Windows

1. Download `PDFAnnotatorSetup.exe` from the [Releases](../../releases) page
2. Double-click to run the installer
3. The installer will:
   - Install **PDF Annotation Studio** to `Program Files`
   - Install **Tesseract OCR** silently (optional, checked by default — required for Parse PDF)
   - Copy **Hindi and Sanskrit language data** (`hin.traineddata`, `san.traineddata`) into Tesseract automatically
   - Download **Microsoft WebView2** if not already on the system (~2 MB, internet required only for this)
4. Launch from the Start Menu or Desktop shortcut

**Disk space:** ~200 MB installed (app ~60 MB + Tesseract ~80 MB + language data ~15 MB)

> **Note:** If you already have Tesseract installed, the installer will skip reinstalling it and only add the Hindi/Sanskrit language files.

---

## Running from Source (Developers)

### Prerequisites

- Python 3.10 or later
- [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) installed and on your PATH (for the Parse feature)
  - Hindi data: `hin.traineddata` in Tesseract's `tessdata/` folder
  - Sanskrit data: `san.traineddata` in Tesseract's `tessdata/` folder

### Setup

```bash
# Clone the repo
git clone <repo-url>
cd "PDF Annotator"

# Create and activate a virtual environment (recommended)
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Run

```bash
python main.py
```

The app opens a native window powered by pywebview (WebView2 on Windows, WebKit on macOS/Linux).

---

## Annotation Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| **Select** | `V` | Click to select a region; drag to move it |
| **Rectangle** | `R` | Click and drag to draw a bounding box |
| **Polygon** | `G` | Click to place vertices; double-click or click near start to close |
| **Freehand / Lasso** | `F` | Hold and drag; path is simplified with Douglas-Peucker on release |
| **Eraser** | `E` | Click on any region to delete it |
| **Pan** | `Space` / middle-click | Pan the canvas view |

---

## Label System

Five default labels are provided:

| Label | Colour | Purpose |
|-------|--------|---------|
| **Text** | Green | Body text paragraphs |
| **Heading** | Amber | Section headings |
| **Table** | Cyan | Tables and grids |
| **Image** | Purple | Figures, diagrams, illustrations |
| **Ignore** | Red | Areas to skip during OCR parsing |

You can add unlimited custom labels from the **Labels** sidebar tab or the **+ Add** button in the label bar. Labels can be renamed and recoloured at any time. The `Ignore` label (identified by name, case-insensitive) is always skipped by the OCR parser regardless of its ID.

Keyboard shortcuts `1`–`9` select the first nine labels in order.

---

## Saving & Persistence

Annotations are saved as a JSON file placed **next to the PDF**:

```
my-document.pdf
my-document_annotations.json   ← created automatically
```

The file is linked to its PDF by an MD5 hash of the PDF content, so renaming the PDF while keeping the annotation file in the same folder still works.

**Save triggers:**
- **Ctrl+S** — manual save
- **Auto-save** — 60 seconds after any edit (debounced)
- **Page switch** — silently saves the current page if dirty
- **Before OCR parse** — the app saves automatically before reading annotation data

When you reopen a PDF, if its annotation file exists in the same folder, all regions, labels, and notes are restored exactly as you left them.

---

## Parse PDF (OCR)

The Parse feature runs Tesseract OCR on annotated regions and exports the extracted text.

### Workflow

1. Annotate your PDF with labelled regions (non-Ignore labels)
2. Click **Parse** in the toolbar (enabled once a PDF is open)
3. In the **Parse Options** dialog:
   - **Select pages** — only annotated pages are listed; pick any subset with the checkboxes or use All / None
   - **OCR Language** — Tesseract language code(s), default `hin+san+eng`; change to `eng` for English-only, or any other [Tesseract language code](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html)
   - **Output format** — Plain Text, Structured JSON, or both
4. Click **Start Parse**
5. A progress bar tracks each page and region as OCR runs in the background
6. On completion, click **Save as TXT** and/or **Save as JSON** — a Save-As dialog opens pre-navigated to the PDF's folder

### OCR behaviour

- Regions are sorted **top-to-bottom** within each page before OCR
- `Ignore`-labelled regions are skipped entirely
- Each region is cropped from a 300 DPI render before being sent to Tesseract (higher quality than the display render)
- You can **Cancel** at any time between regions

### Language codes

| Language | Code |
|----------|------|
| Hindi | `hin` |
| Sanskrit | `san` |
| English | `eng` |
| Multiple | `hin+san+eng` |

---

## Annotation File Format

`<name>_annotations.json` — human-readable, UTF-8 encoded.

```jsonc
{
  "pdf": "my-document.pdf",
  "pdf_hash": "0f291d452d45",        // MD5 of PDF content (first 12 hex chars)
  "created": "2026-04-01T10:00:00",
  "last_modified": "2026-04-03T14:22:10",
  "labels": [
    { "id": "text",    "name": "Text",    "color": "#22c55e" },
    { "id": "heading", "name": "Heading", "color": "#f59e0b" },
    { "id": "ignore",  "name": "Ignore",  "color": "#ef4444" }
  ],
  "pages": {
    "1": [
      {
        "id": "r_1775132529066_0",
        "label": "heading",           // references a label id
        "shape": "rect",              // "rect" | "polygon" | "freehand"
        "pts": [
          { "x": 0.2151, "y": 0.1173 },   // normalised 0–1 coordinates
          { "x": 0.7465, "y": 0.1173 },   // relative to rendered page size
          { "x": 0.7465, "y": 0.2022 },
          { "x": 0.2151, "y": 0.2022 }
        ],
        "note": ""                    // optional free-text note
      }
    ]
  }
}
```

All coordinates are **normalised fractions** (0.0–1.0) of the rendered page pixel dimensions, making them resolution-independent. Rectangles are stored as 4 corner points; polygons and freehand shapes store their full vertex list.

---

## OCR Output Formats

### Plain Text (`.txt`)

Human-readable, one section per page:

```
============================================================
  PAGE 1
============================================================

[HEADING]
अथ षष्ठ आम्रादिफलवर्गः

[TEXT]
वैशाली अथ वन्यमहीरुहाणां फलानि वक्ष्यामः …
```

### Structured JSON (`.json`)

Machine-readable, one entry per region with metadata:

```jsonc
{
  "source": "my-document.pdf",
  "lang": "hin+san+eng",
  "dpi": 300,
  "pages_parsed": 5,
  "pages": {
    "1": [
      {
        "page": 1,
        "label": "Heading",
        "source": "annotated",
        "text": "अथ षष्ठ आम्रादिफलवर्गः",
        "note": "",
        "bbox": { "x": 0.2151, "y": 0.1173, "w": 0.5314, "h": 0.0848 }
      }
    ]
  }
}
```

---

## Building the Installer

### Requirements

- Windows (the installer targets Windows)
- Python 3.10+
- [Inno Setup 6](https://jrsoftware.org/isdl.php) (auto-installed by the script if missing via winget)
- Internet connection on first build (to download Tesseract + tessdata)

### Steps

```bat
build_installer.bat
```

This script does everything in order:

| Step | Action |
|------|--------|
| 1 | Checks Python is available |
| 2 | Installs Python dependencies + PyInstaller |
| 3 | Downloads Tesseract installer + `hin.traineddata` + `san.traineddata` into `installer/` (skipped if already present) |
| 3b | Generates the app icon (`installer/icon.ico`) |
| 4 | Builds `dist/PDFAnnotator.exe` with PyInstaller (single-file, no console) |
| 5 | Compiles `installer/Output/PDFAnnotatorSetup.exe` with Inno Setup |

**Output:** `installer/Output/PDFAnnotatorSetup.exe` — distribute this file to users.

> The Tesseract installer and tessdata files are downloaded once and cached in `installer/`. They are gitignored and re-downloaded if missing.

---

## GitHub Actions CI

The workflow at `.github/workflows/build.yml` builds and releases the installer automatically.

### Triggers

| Event | Action |
|-------|--------|
| Push a tag `v*` (e.g. `v1.2.0`) | Full build + GitHub Release created |
| Manual trigger (`workflow_dispatch`) | Full build + artifact uploaded (no release) |

### Pipeline steps

```
Checkout → Python setup → Install deps
  → Generate icon → Build .exe (PyInstaller)
  → Cache / Download Tesseract + tessdata
  → Verify all components present
  → Build installer (Inno Setup)
  → Upload artifact
  → Create GitHub Release (tag builds only)
```

The Tesseract components (~45 MB total) are cached between runs using `actions/cache`. On a cache hit the download step is skipped entirely.

### Creating a release

```bash
git tag v1.2.0
git push origin v1.2.0
```

This triggers the workflow and produces a GitHub Release with `PDFAnnotatorSetup.exe` attached.

---

## Project Structure

```
PDF Annotator/
│
├── main.py                     # Python backend — pywebview API, PDF rendering,
│                               # annotation persistence, OCR orchestration
│
├── requirements.txt            # Python dependencies
├── PDFAnnotator.spec           # PyInstaller build spec
│
├── static/
│   ├── index.html              # App shell — toolbar, canvas, sidebar, modals
│   ├── app.js                  # Canvas engine, drawing tools, undo/redo, state
│   ├── ui.js                   # Label manager, sidebar, thumbnails, parse UI
│   └── style.css               # All styles (dark + light theme)
│
├── installer/
│   ├── setup.iss               # Inno Setup script — bundles Tesseract + tessdata
│   ├── create_icon.py          # Generates icon.ico programmatically
│   ├── version_info.txt        # Windows version metadata (embedded in .exe)
│   ├── icon.ico                # Generated app icon
│   ├── tesseract-ocr-w64-setup.exe   # Downloaded by build script (gitignored)
│   ├── tessdata/
│   │   ├── hin.traineddata     # Downloaded by build script (gitignored)
│   │   └── san.traineddata     # Downloaded by build script (gitignored)
│   └── Output/
│       └── PDFAnnotatorSetup.exe     # Final installer (gitignored)
│
├── build.bat                   # Quick PyInstaller-only build
├── build_installer.bat         # Full build: deps + icon + exe + installer
│
└── .github/
    └── workflows/
        └── build.yml           # CI: build + release on version tag push
```

---

## Dependencies

### Python packages (`requirements.txt`)

| Package | Version | Purpose |
|---------|---------|---------|
| `pywebview` | ≥ 5.0.5 | Native window hosting the HTML/JS UI |
| `pypdfium2` | ≥ 4.30.0 | PDF rendering (wraps PDFium) |
| `Pillow` | ≥ 10.0.0 | Image manipulation for OCR crops |
| `pytesseract` | ≥ 0.3.10 | Python wrapper for Tesseract OCR |

### System dependencies

| Dependency | Required for | Notes |
|------------|-------------|-------|
| **Tesseract OCR** | Parse PDF feature | Bundled in installer; for dev installs see [UB-Mannheim builds](https://github.com/UB-Mannheim/tesseract/wiki) |
| **Microsoft WebView2** | App window rendering | Pre-installed on Windows 11; downloaded automatically by installer on Windows 10 |

### Frontend

Vanilla JavaScript, HTML5 Canvas API — no npm, no frameworks, no build step.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open PDF |
| `Ctrl+S` | Save annotations |
| `V` | Select tool |
| `R` | Rectangle tool |
| `G` | Polygon tool |
| `F` | Freehand / Lasso tool |
| `E` | Eraser tool |
| `Space` (hold) | Temporarily switch to Pan |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `←` / `→` | Previous / next page |
| `+` / `-` | Zoom in / out |
| `0` | Fit page to window |
| `T` | Toggle light/dark theme |
| `1`–`9` | Select label by position |
| `Backspace` / `Delete` | Delete selected region |
| `Escape` | Cancel drawing / close modal |

# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for PDF Annotation Studio.
Produces a single self-contained .exe — no Python required to run.
"""

from pathlib import Path
import sys

ROOT = Path(SPECPATH)

a = Analysis(
    [str(ROOT / "main.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / "static"), "static"),
    ],
    hiddenimports=[
        "pypdfium2",
        "pypdfium2._helpers",
        "webview",
        "webview.platforms.winforms",
        "clr",
        "PIL",
        "PIL.Image",
        "PIL.ImageDraw",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "scipy"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="PDFAnnotator",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,                          # compress — reduces file size
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,                     # no console window
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "installer" / "icon.ico"),
    version_file=str(ROOT / "installer" / "version_info.txt"),
)

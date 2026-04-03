@echo off
setlocal EnableDelayedExpansion
title PDF Annotation Studio — Build Installer

echo.
echo  ================================================
echo   PDF Annotation Studio — Build Installer v1.0
echo  ================================================
echo.

:: ── Step 1: Check Python ─────────────────────────────────────────────────────
echo [1/5] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Python is not installed or not in PATH.
    echo  Download Python 3.10+ from https://www.python.org/downloads/
    echo  Make sure to check "Add Python to PATH" during install.
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo  Found: %%v

:: ── Step 2: Install Python dependencies ──────────────────────────────────────
echo.
echo [2/5] Installing dependencies...
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt pyinstaller --quiet
if errorlevel 1 (
    echo  ERROR: Failed to install dependencies.
    pause & exit /b 1
)
echo  Dependencies installed.

:: ── Step 3: Download Tesseract OCR components ────────────────────────────────
echo.
echo [3/5] Preparing Tesseract OCR components...
echo  (These are bundled into the installer so end-users don't need to download them)
echo.

if not exist "installer\tessdata" mkdir installer\tessdata

:: Tesseract Windows installer — fetch latest release from UB-Mannheim via GitHub API
if not exist "installer\tesseract-ocr-w64-setup.exe" (
    echo  Resolving latest Tesseract release...
    powershell -NoProfile -NonInteractive -Command ^
        "$r = Invoke-RestMethod 'https://api.github.com/repos/UB-Mannheim/tesseract/releases/latest' -Headers @{'User-Agent'='curl'}; $a = $r.assets | Where-Object { $_.name -like 'tesseract-ocr-w64-setup-*.exe' } | Select-Object -First 1; if (-not $a) { exit 1 }; Write-Host ('Downloading: ' + $a.name); curl.exe -L --fail -o 'installer\tesseract-ocr-w64-setup.exe' $a.browser_download_url"
    if errorlevel 1 (
        echo  ERROR: Could not download Tesseract installer.
        echo  Download manually from: https://github.com/UB-Mannheim/tesseract/wiki
        echo  Save it as: installer\tesseract-ocr-w64-setup.exe
        pause & exit /b 1
    )
    echo  Tesseract installer downloaded.
) else (
    echo  Tesseract installer already present, skipping download.
)

:: Hindi language data (tessdata_fast)
if not exist "installer\tessdata\hin.traineddata" (
    echo  Downloading Hindi language data...
    curl.exe -L --fail -o "installer\tessdata\hin.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/hin.traineddata"
    if errorlevel 1 (
        echo  ERROR: Could not download Hindi language data (hin.traineddata).
        echo  Download manually from: https://github.com/tesseract-ocr/tessdata_fast
        pause & exit /b 1
    )
    echo  Hindi language data downloaded.
) else (
    echo  Hindi language data already present, skipping download.
)

:: Sanskrit language data
if not exist "installer\tessdata\san.traineddata" (
    echo  Downloading Sanskrit language data...
    curl.exe -L --fail -o "installer\tessdata\san.traineddata" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/san.traineddata"
    if errorlevel 1 (
        echo  ERROR: Could not download Sanskrit language data (san.traineddata).
        echo  Download manually from: https://github.com/tesseract-ocr/tessdata_fast
        pause & exit /b 1
    )
    echo  Sanskrit language data downloaded.
) else (
    echo  Sanskrit language data already present, skipping download.
)

echo  All Tesseract components ready.

:: ── Step 3b: Generate icon ────────────────────────────────────────────────────
echo.
echo [3b/5] Generating app icon...
if not exist "installer\icon.ico" (
    python installer\create_icon.py
    if errorlevel 1 (
        echo  WARNING: Could not generate icon. Using default.
    )
) else (
    echo  Icon already exists, skipping.
)

:: ── Step 4: Build .exe with PyInstaller ──────────────────────────────────────
echo.
echo [4/5] Building executable with PyInstaller...
echo  (This may take 2-5 minutes on first run)
echo.

if exist dist\PDFAnnotator.exe del /f /q dist\PDFAnnotator.exe
if exist build rmdir /s /q build

pyinstaller PDFAnnotator.spec --noconfirm
if errorlevel 1 (
    echo.
    echo  ERROR: PyInstaller build failed.
    pause & exit /b 1
)

if not exist dist\PDFAnnotator.exe (
    echo  ERROR: PDFAnnotator.exe was not produced.
    pause & exit /b 1
)

for %%F in (dist\PDFAnnotator.exe) do (
    set /a SIZE_MB=%%~zF / 1048576
    echo  Executable built: dist\PDFAnnotator.exe  (!SIZE_MB! MB^)
)

:: ── Step 5: Build installer with Inno Setup ───────────────────────────────────
echo.
echo [5/5] Building installer with Inno Setup...

:: Look for Inno Setup compiler in common locations
set ISCC=
for %%P in (
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    "C:\Program Files\Inno Setup 6\ISCC.exe"
    "C:\Program Files (x86)\Inno Setup 5\ISCC.exe"
    "C:\Program Files\Inno Setup 5\ISCC.exe"
) do (
    if exist %%P set ISCC=%%P
)

if "!ISCC!"=="" (
    echo.
    echo  Inno Setup not found. Attempting to install via winget...
    winget install JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo  Could not auto-install Inno Setup.
        echo  Please install it manually from: https://jrsoftware.org/isdl.php
        echo.
        echo  After installing, re-run this script.
        echo  OR: Your .exe is already at dist\PDFAnnotator.exe (no installer wrapper).
        pause & exit /b 1
    )
    :: Re-check after install
    for %%P in (
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    ) do (
        if exist %%P set ISCC=%%P
    )
)

if "!ISCC!"=="" (
    echo  ERROR: Inno Setup still not found after install attempt.
    pause & exit /b 1
)

echo  Using Inno Setup: !ISCC!
if not exist installer\Output mkdir installer\Output

!ISCC! installer\setup.iss
if errorlevel 1 (
    echo  ERROR: Inno Setup build failed.
    pause & exit /b 1
)

:: ── Done ──────────────────────────────────────────────────────────────────────
echo.
echo  ================================================
echo   BUILD COMPLETE
echo  ================================================
echo.
echo  Installer: installer\Output\PDFAnnotatorSetup.exe
echo.
for %%F in (installer\Output\PDFAnnotatorSetup.exe) do (
    set /a SIZE_MB=%%~zF / 1048576
    echo  Size: !SIZE_MB! MB
)
echo.
echo  Share  installer\Output\PDFAnnotatorSetup.exe  with your users.
echo  They just double-click it — no Python needed.
echo.
pause

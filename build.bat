@echo off
:: ============================================================
::  PDF Annotation Studio — Windows Build Script
::  Produces a single .exe in dist\PDFAnnotator.exe
:: ============================================================

echo.
echo  PDF Annotation Studio — Build
echo  ==============================

:: 1. Install deps (first-time setup)
echo [1/4] Installing Python dependencies...
pip install -r requirements.txt --quiet
if errorlevel 1 (echo ERROR: pip install failed & pause & exit /b 1)

:: 2. Install PyInstaller
echo [2/4] Installing PyInstaller...
pip install pyinstaller --quiet
if errorlevel 1 (echo ERROR: PyInstaller install failed & pause & exit /b 1)

:: 3. Build
echo [3/4] Building executable...
echo NOTE: Tesseract OCR engine must be installed separately on the target machine.
echo       Download from: https://github.com/tesseract-ocr/tesseract
echo       Hindi+Sanskrit data files (hin.traineddata, san.traineddata) must be in Tesseract tessdata folder.
echo.
pyinstaller ^
  --onefile ^
  --noconsole ^
  --name "PDFAnnotator" ^
  --add-data "static;static" ^
  --hidden-import "pypdfium2" ^
  --hidden-import "webview" ^
  --hidden-import "PIL" ^
  --hidden-import "pytesseract" ^
  --icon "static\icon.ico" ^
  main.py

if errorlevel 1 (echo ERROR: Build failed & pause & exit /b 1)

:: 4. Done
echo [4/4] Done!
echo.
echo  Output: dist\PDFAnnotator.exe
echo  Size:
for %%F in (dist\PDFAnnotator.exe) do echo    %%~zF bytes
echo.
pause

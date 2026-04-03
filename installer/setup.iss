; ============================================================
;  PDF Annotation Studio — Inno Setup Installer Script
;  Produces: PDFAnnotatorSetup.exe (~single file, self-extracting)
; ============================================================

#define AppName      "PDF Annotation Studio"
#define AppVersion   "1.1.0"
#define AppPublisher "PDF Annotation Studio"
#define AppExeName   "PDFAnnotator.exe"
#define AppURL       ""

[Setup]
AppId                    = {{A3F2C1D4-8B5E-4F9A-B2D7-6E1C3A8F2D45}
AppName                  = {#AppName}
AppVersion               = {#AppVersion}
AppVerName               = {#AppName} {#AppVersion}
AppPublisher             = {#AppPublisher}
AppPublisherURL          = {#AppURL}
AppSupportURL            = {#AppURL}
AppUpdatesURL            = {#AppURL}

; Install into Program Files
DefaultDirName           = {autopf}\{#AppName}
DefaultGroupName         = {#AppName}
AllowNoIcons             = yes

; Output
OutputDir                = {#SourcePath}\Output
OutputBaseFilename       = PDFAnnotatorSetup
SetupIconFile            = {#SourcePath}\icon.ico
UninstallDisplayIcon     = {app}\{#AppExeName}

; Compression — maximum for smallest installer
Compression              = lzma2/ultra64
SolidCompression         = yes
LZMAUseSeparateProcess   = yes

; Require admin to install into Program Files
PrivilegesRequired       = admin
PrivilegesRequiredOverridesAllowed = dialog

; Minimum Windows version: Windows 10
MinVersion               = 10.0

; Appearance
WizardStyle              = modern
WizardSizePercent        = 110
DisableWelcomePage       = no
DisableDirPage           = no
DisableProgramGroupPage  = yes

; Allow user to choose desktop icon
; (handled in [Tasks])

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";   Description: "Create a &desktop shortcut";                              GroupDescription: "Additional icons:"; Flags: unchecked
Name: "quicklaunch";   Description: "Pin to &taskbar";                                         GroupDescription: "Additional icons:"; Flags: unchecked; OnlyBelowVersion: 6.1; Check: not IsAdminInstallMode
Name: "tesseract";     Description: "Install &Tesseract OCR engine (required for Parse PDF)";  GroupDescription: "Components:"; Flags: checkedonce

[Files]
; Main executable (built by PyInstaller)
Source: "{#SourcePath}\..\dist\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; ── Tesseract OCR — bundled installer ─────────────────────────────────────────
; Installer goes to {tmp} and is auto-deleted when setup exits.
Source: "{#SourcePath}\tesseract-ocr-w64-setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Tasks: tesseract

; ── Language data — copied directly into the app folder by Inno Setup ─────────
; This avoids any Pascal FileCopy permission issues.  main.py sets
; TESSDATA_PREFIX to {app} so Tesseract finds these files automatically.
Source: "{#SourcePath}\tessdata\eng.traineddata"; DestDir: "{app}\tessdata"; Flags: ignoreversion; Tasks: tesseract
Source: "{#SourcePath}\tessdata\hin.traineddata"; DestDir: "{app}\tessdata"; Flags: ignoreversion; Tasks: tesseract
Source: "{#SourcePath}\tessdata\san.traineddata"; DestDir: "{app}\tessdata"; Flags: ignoreversion; Tasks: tesseract

[Icons]
; Start menu
Name: "{group}\{#AppName}";               Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}";     Filename: "{uninstallexe}"

; Desktop (optional)
Name: "{autodesktop}\{#AppName}";         Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; IconFilename: "{app}\{#AppExeName}"

[Run]
; Offer to launch after install
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up user data folder on uninstall (optional — comment out to keep user data)
; Type: filesandordirs; Name: "{userdocs}\PDFAnnotator"

[Code]

// ── WebView2 ──────────────────────────────────────────────────────────────────

function WebView2IsInstalled: Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(
    HKLM,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv', Version
  ) and (Version <> '');
  if not Result then
    Result := RegQueryStringValue(
      HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version
    ) and (Version <> '');
end;

procedure InstallWebView2;
var
  TempFile, Url, Args: String;
  ResultCode: Integer;
begin
  Url      := 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
  TempFile := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');

  if not FileExists(TempFile) then begin
    Args := '-NoProfile -NonInteractive -Command "Invoke-WebRequest -Uri ''' + Url + ''' -OutFile ''' + TempFile + '''"';
    if not Exec('powershell.exe', Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then begin
      MsgBox(
        'Could not download WebView2 runtime.'#13#10 +
        'Please install it manually from:'#13#10 +
        'https://developer.microsoft.com/en-us/microsoft-edge/webview2/',
        mbError, MB_OK
      );
      Exit;
    end;
  end;

  Exec(TempFile, '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
end;

// ── Tesseract OCR ─────────────────────────────────────────────────────────────

// Returns the Tesseract install directory.
// Tries multiple registry locations the UB-Mannheim NSIS installer may write,
// then falls back to the standard Program Files path.
function GetTesseractDir: String;
var
  Dir, UninstallStr: String;
begin
  // 1. Direct InstallDir value (some versions)
  if RegQueryStringValue(HKLM, 'SOFTWARE\Tesseract-OCR', 'InstallDir', Dir) and (Dir <> '') then begin
    Result := RemoveBackslashUnlessRoot(Dir); Exit;
  end;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Tesseract-OCR', 'InstallDir', Dir) and (Dir <> '') then begin
    Result := RemoveBackslashUnlessRoot(Dir); Exit;
  end;
  // 2. Derive path from the uninstall string (most reliable for NSIS installers)
  if RegQueryStringValue(HKLM,
      'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Tesseract-OCR',
      'UninstallString', UninstallStr) and (UninstallStr <> '') then begin
    Result := RemoveBackslashUnlessRoot(ExtractFilePath(UninstallStr)); Exit;
  end;
  if RegQueryStringValue(HKLM,
      'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Tesseract-OCR',
      'UninstallString', UninstallStr) and (UninstallStr <> '') then begin
    Result := RemoveBackslashUnlessRoot(ExtractFilePath(UninstallStr)); Exit;
  end;
  // 3. Hard fallback
  Result := ExpandConstant('{pf}\Tesseract-OCR');
end;

function TesseractIsInstalled: Boolean;
begin
  Result := FileExists(AddBackslash(GetTesseractDir) + 'tesseract.exe');
end;

// Runs the bundled Tesseract installer silently.
// Language data (hin/san) is placed into {app}\tessdata by the [Files] section;
// main.py sets TESSDATA_PREFIX={app} at runtime so Tesseract finds them there.
procedure InstallTesseract;
var
  ResultCode: Integer;
  TessExe: String;
begin
  TessExe := ExpandConstant('{tmp}\tesseract-ocr-w64-setup.exe');
  if not FileExists(TessExe) then begin
    MsgBox(
      'Tesseract installer could not be found in the package.'#13#10 +
      'The "Parse PDF" feature will not work.'#13#10 +
      'You can install Tesseract manually from:'#13#10 +
      'https://github.com/UB-Mannheim/tesseract/wiki',
      mbError, MB_OK
    );
    Exit;
  end;

  // /S = NSIS silent install; installs to default location (Program Files\Tesseract-OCR)
  if not Exec(TessExe, '/S', '', SW_SHOW, ewWaitUntilTerminated, ResultCode) or
     (ResultCode <> 0) then begin
    MsgBox(
      'Tesseract OCR installation failed (exit code: ' + IntToStr(ResultCode) + ').'#13#10 +
      'The "Parse PDF" feature will not work.'#13#10 +
      'You can install Tesseract manually from:'#13#10 +
      'https://github.com/UB-Mannheim/tesseract/wiki',
      mbError, MB_OK
    );
    Exit;
  end;
  // Language data is already placed in {app}\tessdata by the [Files] section.
end;

// ── Installation steps ────────────────────────────────────────────────────────

procedure CurStepChanged(CurStep: TSetupStep);
begin
  // ssInstall  = just before files are written
  if CurStep = ssInstall then begin
    if not WebView2IsInstalled then begin
      if MsgBox(
        'PDF Annotation Studio requires the Microsoft WebView2 runtime which is not installed.'#13#10#13#10 +
        'It will be downloaded and installed automatically (~2 MB).'#13#10 +
        'Click OK to continue.',
        mbInformation, MB_OKCANCEL
      ) = IDOK then
        InstallWebView2;
    end;
  end;

  // ssPostInstall = after all app files are written.
  // Run the Tesseract installer if the user selected that task and it is not
  // already present.  Language data is copied to {app}\tessdata by the [Files]
  // section, so no extra Pascal copying is needed.
  if CurStep = ssPostInstall then begin
    if WizardIsTaskSelected('tesseract') then begin
      if not TesseractIsInstalled then
        InstallTesseract;
    end;
  end;
end;

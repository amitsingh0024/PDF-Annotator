; ============================================================
;  PDF Annotation Studio — Inno Setup Installer Script
;  Produces: PDFAnnotatorSetup.exe (~single file, self-extracting)
; ============================================================

#define AppName      "PDF Annotation Studio"
#define AppVersion   "1.0.0"
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
Name: "desktopicon";   Description: "Create a &desktop shortcut";   GroupDescription: "Additional icons:"; Flags: unchecked
Name: "quicklaunch";   Description: "Pin to &taskbar";              GroupDescription: "Additional icons:"; Flags: unchecked; OnlyBelowVersion: 6.1; Check: not IsAdminInstallMode

[Files]
; Main executable (built by PyInstaller)
Source: "{#SourcePath}\..\dist\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

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
// Check for WebView2 runtime (required by pywebview on Windows)
// If missing, download and install it silently before finishing setup.

function WebView2IsInstalled: Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(
    HKLM,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv',
    Version
  ) and (Version <> '');
  if not Result then
    Result := RegQueryStringValue(
      HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv',
      Version
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

procedure CurStepChanged(CurStep: TSetupStep);
begin
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
end;

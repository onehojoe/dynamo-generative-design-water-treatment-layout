@echo off
rem ===========================================================
rem  Terrain & Alignment GD Workbench - launcher
rem
rem  THIS FILE MUST STAY PURE ASCII WITH CRLF LINE ENDINGS.
rem  cmd.exe reads .bat using the OEM codepage (949 on Korean
rem  Windows). UTF-8 Korean text here is mangled and then parsed
rem  as commands. "chcp 65001" does NOT prevent it.
rem
rem  No Python, no server, no internet required. Data is baked
rem  into data\*.js so the page runs straight from file://.
rem ===========================================================
setlocal
cd /d "%~dp0"

set "PAGE=%~dp0web\index.html"
if not exist "%PAGE%" goto NOPAGE

echo.
echo   Opening Terrain ^& Alignment GD Workbench...
echo   %PAGE%
echo.

rem  Prefer Chrome or Edge explicitly. Some machines have a PDF
rem  reader or an editor registered for .html, which would open
rem  the source instead of rendering it.
set "BR="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BR=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BR if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BR=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BR if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BR=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BR if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BR=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BR if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BR=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if defined BR (
    start "" "%BR%" "file:///%PAGE:\=/%"
) else (
    echo   [note] Chrome/Edge not found - using the default handler.
    start "" "%PAGE%"
)

echo   If nothing appeared, open this file by hand:
echo     %PAGE%
echo.
timeout /t 4 >nul
exit /b 0

:NOPAGE
echo.
echo   [ERROR] web\index.html is missing. The package is incomplete.
echo   Re-extract the zip, keeping the folder structure.
echo.
pause
exit /b 1

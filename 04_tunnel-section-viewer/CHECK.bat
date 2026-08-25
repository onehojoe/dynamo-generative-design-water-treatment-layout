@echo off
setlocal
chcp 65001 >nul
title NATM Viewer - Self Check
cd /d "%~dp0"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

echo ==================================================================
echo   Self check - environment and engine
echo ==================================================================
echo.

set "PYEXE="
if exist "%~dp0runtime\python.exe" set "PYEXE=%~dp0runtime\python.exe"
if not defined PYEXE call :trypy py -3
if not defined PYEXE call :trypy python
if not defined PYEXE call :trypy python3
if not defined PYEXE for /f "delims=" %%P in ('dir /b /s "%LOCALAPPDATA%\Programs\Python\python.exe" 2^>nul') do if not defined PYEXE set "PYEXE=%%P"
if not defined PYEXE for /f "delims=" %%P in ('dir /b /s "C:\Python3*\python.exe" 2^>nul') do if not defined PYEXE set "PYEXE=%%P"
if not defined PYEXE goto NOPY

echo  python : %PYEXE%
echo.
%PYEXE% "90_dist\diagnose.py"
echo.
pause
exit /b 0

:trypy
if defined PYEXE goto :eof
%* --version >nul 2>&1
if errorlevel 1 goto :eof
set "PYEXE=%*"
goto :eof

:NOPY
echo.
echo  [ERROR] Python 3 was not found on this PC.
echo.
echo   1) Install Python 3.8 or newer:  https://www.python.org/downloads/windows/
echo      - check "Add python.exe to PATH" during setup
echo   2) Or put a portable python under:  %~dp0runtime\python.exe
echo.
echo   No extra package is required. (ezdxf is optional, DXF export only)
echo.
pause
exit /b 9

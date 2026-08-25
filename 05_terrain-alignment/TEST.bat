@echo off
rem  Self check. PURE ASCII + CRLF. See RUN.bat for why.
setlocal
cd /d "%~dp0"

set "PY="
python -V 2>&1 | findstr /b /c:"Python 3" >nul
if not errorlevel 1 set "PY=python"
if not defined PY (
    py -3 -V 2>&1 | findstr /b /c:"Python 3" >nul
    if not errorlevel 1 set "PY=py -3"
)

if not defined PY (
    echo.
    echo   Python 3 was not found - running the offline file check only.
    echo.
    if exist "web\index.html" (echo   OK   web\index.html) else (echo   FAIL web\index.html)
    if exist "data\site.js" (echo   OK   data\site.js) else (echo   FAIL data\site.js)
    if exist "data	errain.js" (echo   OK   data	errain.js) else (echo   FAIL data	errain.js)
    if exist "web\jspp.js" (echo   OK   web\jspp.js) else (echo   FAIL web\jspp.js)
    echo.
    echo   The workbench itself does NOT need Python. This is only the checker.
    echo.
    pause
    exit /b 0
)

%PY% "%~dp0tools\selfcheck.py"
echo.
pause
exit /b 0

@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
if defined NODE_MAJOR (
  if !NODE_MAJOR! LSS 24 (
    echo Node.js 24 or newer is required. Found version:
    node --version
    pause
    exit /b 1
  )
)

set "SEHAT_PORT=3001"
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if /i "%%a"=="PORT" if not "%%b"=="" set "SEHAT_PORT=%%b"
  )
)

set "OPEN_BROWSER=1"
set "PREV="
if not "%~1"=="" (
  for %%A in (%*) do (
    if /i "!PREV!"=="--port" set "SEHAT_PORT=%%~A"
    if /i "%%~A"=="--no-open" set "OPEN_BROWSER=0"
    if /i "%%~A"=="--status" set "OPEN_BROWSER=0"
    if /i "%%~A"=="--stop" set "OPEN_BROWSER=0"
    set "PREV=%%~A"
  )
)

node scripts\launch.mjs --background --no-open %*
if errorlevel 1 (
  echo.
  echo Launch failed. Details are above. No unrelated application was stopped.
  pause
  exit /b 1
)

if "!OPEN_BROWSER!"=="1" (
  start "" "http://127.0.0.1:!SEHAT_PORT!"
)

if "%~1"=="" (
  echo.
  echo ========================================================
  echo   Sehat is ready at http://127.0.0.1:!SEHAT_PORT!
  echo   To stop the application, double-click STOP_SEHAT.bat
  echo ========================================================
  echo.
  echo Press any key to close this launcher window...
  pause >nul
)
endlocal

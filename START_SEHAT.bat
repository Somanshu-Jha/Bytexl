@echo off
REM Sehat - single-click launcher for Windows.
REM Starts the local API and the interface, waits until both answer, then opens the browser.
REM Everything runs on loopback (127.0.0.1) only.

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "API_PORT=3001"
set "WEB_PORT=5173"

echo.
echo   sehat.  Starting your health record workspace
echo   ============================================
echo.

REM ---------- 1. Node.js present and new enough ----------
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js not found.
  echo       Install Node 24 or newer from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if !NODE_MAJOR! LSS 24 (
  echo   [X] Node.js !NODE_MAJOR! found, but Sehat needs Node 24 or newer.
  echo       Node 24 includes the built-in SQLite that stores your records.
  echo       Current version:
  node --version
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo   [1/6] Node.js %%v .................. ready

where npm >nul 2>&1
if errorlevel 1 (
  echo   [X] npm not found. Reinstall Node.js from https://nodejs.org/.
  echo.
  pause
  exit /b 1
)

REM ---------- 2. Dependencies ----------
if not exist "node_modules" (
  echo   [2/6] First run - installing dependencies...
  echo         This downloads packages once and can take a few minutes.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [X] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo         Dependencies installed.
) else (
  echo   [2/6] Dependencies ................. ready
)

REM ---------- 3. Configuration ----------
if not exist ".env" (
  if exist ".env.example" copy /y ".env.example" ".env" >nul
  echo   [3/6] Created .env from the example.
  echo         Add NVIDIA_API_KEY to enable AI reading of images and scanned PDFs.
  echo         Without a key the app still runs: you can browse, edit and read text reports.
) else (
  findstr /b /c:"NVIDIA_API_KEY=" ".env" | findstr /r /c:"NVIDIA_API_KEY=..*" >nul 2>&1
  if errorlevel 1 (
    echo   [3/6] Config ....................... no NVIDIA key
    echo         Text reports work locally. Images and scanned PDFs need a key in .env.
  ) else (
    echo   [3/6] Config ....................... NVIDIA key found
  )
)

REM ---------- 4. Free the ports if a previous run left them busy ----------
set "FREED=0"
for %%P in (%API_PORT% %WEB_PORT%) do (
  for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /r /c:":%%P .*LISTENING"') do (
    echo   [4/6] Port %%P busy - stopping old process %%a
    taskkill /f /pid %%a >nul 2>&1
    set "FREED=1"
  )
)
if "!FREED!"=="0" echo   [4/6] Ports %API_PORT% and %WEB_PORT% ...... free
ping -n 3 127.0.0.1 >nul 2>&1

REM ---------- 5. Build the interface if it has never been built ----------
if not exist "dist\index.html" (
  echo   [5/6] Building the interface for the first time...
  call npm run build
  if errorlevel 1 (
    echo.
    echo   [X] Build failed. Run "npm run build" to see the full error.
    pause
    exit /b 1
  )
  echo         Build complete.
) else (
  echo   [5/6] Interface build .............. ready
)

REM ---------- 6. Start both services ----------
echo   [6/6] Starting services...
echo.

set "SEHAT_DEV_ORIGINS=http://127.0.0.1:%WEB_PORT%,http://localhost:%WEB_PORT%"

REM The API in its own window so its log stays readable and it can be stopped on its own.
start "Sehat API (port %API_PORT%)" cmd /k "node --env-file-if-exists=.env server/index.mjs"

REM The interface in its own window (Vite dev server, proxies /api to the API).
start "Sehat Interface (port %WEB_PORT%)" cmd /k "npx vite --host 127.0.0.1 --port %WEB_PORT% --strictPort"

echo   Waiting for the workspace to answer...
set "READY=0"
for /l %%i in (1,1,60) do (
  if "!READY!"=="0" (
    ping -n 2 127.0.0.1 >nul 2>&1
    curl -s -o nul --max-time 2 "http://127.0.0.1:%WEB_PORT%/api/health" 2>nul
    if not errorlevel 1 set "READY=1"
  )
)

echo.
if "!READY!"=="1" (
  echo   Sehat is ready at http://localhost:%WEB_PORT%
  echo.
  echo   The browser will open shortly.
  echo   To stop the app, close the "Sehat API" and "Sehat Interface" windows,
  echo   or press any key in this window.
  echo.
  start "" "http://localhost:%WEB_PORT%"
) else (
  echo   [!] The workspace did not answer within 60 seconds.
  echo       Look at the "Sehat API" and "Sehat Interface" windows for the error.
  echo       Check that port %API_PORT% is free, then run this file again.
  echo.
)

echo   Press any key to close this launcher window (the app keeps running).
pause >nul
endlocal

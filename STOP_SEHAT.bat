@echo off
REM Sehat - stop the local API and interface.
REM Use this if a previous run was closed by shutting the window rather than stopping cleanly.

setlocal EnableDelayedExpansion
echo.
echo   Stopping Sehat...
echo.

set "FOUND=0"
for %%P in (3001 5173) do (
  for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /r /c:":%%P .*LISTENING"') do (
    echo   Stopping process %%a on port %%P
    taskkill /f /pid %%a >nul 2>&1
    set "FOUND=1"
  )
)

if "!FOUND!"=="0" (
  echo   Nothing was running on ports 3001 or 5173.
) else (
  echo.
  echo   Sehat has stopped. Your records are still saved in the data folder.
)
echo.
echo   Press any key to close.
pause >nul
endlocal

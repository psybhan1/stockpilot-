@echo off
setlocal
cd /d "%~dp0"

set "APP_URL=https://stockpilot-sobha-connect.loca.lt"
set "LT_SUBDOMAIN=stockpilot-sobha-connect"

if not exist "node_modules\better-sqlite3" (
  echo First-time setup detected. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :fail
)

call npm.cmd run db:generate
if errorlevel 1 goto :fail

call npm.cmd run setup:local
if errorlevel 1 goto :fail

call npm.cmd run db:push
if errorlevel 1 goto :fail

if not "%LT_SUBDOMAIN%"=="" (
  start "StockPilot Tunnel" cmd /k "cd /d ""%~dp0"" && npx.cmd localtunnel --port 3000 --subdomain %LT_SUBDOMAIN% --print-requests"
)

start "StockPilot Worker" cmd /k "cd /d ""%~dp0"" && npm.cmd run worker:dev"
start "" cmd /c "timeout /t 8 >nul && start %APP_URL%"
call npm.cmd run dev
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo StockPilot could not launch.
pause
exit /b 1

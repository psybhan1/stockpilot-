@echo off
setlocal
cd /d "%~dp0"

set "NODE_RUNTIME=%~dp0tools\node-v22.22.2-win-x64\npm.cmd"
set "NODE_EXEC=%~dp0tools\node-v22.22.2-win-x64\node.exe"
set "N8N_HOST=127.0.0.1"
set "N8N_PORT=5678"
set "N8N_PROTOCOL=http"
set "N8N_EDITOR_BASE_URL=http://127.0.0.1:5678"
set "N8N_USER_FOLDER=%~dp0runtime"

if not exist "%NODE_RUNTIME%" (
  echo Embedded Node 22 runtime is missing.
  if not defined STOCKPILOT_NO_PAUSE pause
  exit /b 1
)

if not exist "%NODE_EXEC%" (
  echo Embedded Node 22 runtime is missing.
  if not defined STOCKPILOT_NO_PAUSE pause
  exit /b 1
)

if not exist "node_modules\n8n" (
  echo Installing n8n workspace dependencies...
  call "%NODE_RUNTIME%" install
  if errorlevel 1 goto :fail
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
)

if not exist "runtime\.n8n\database.sqlite" (
  echo Preparing StockPilot workflows in local n8n runtime...
  call "%~dp0Import-StockPilot-n8n.cmd"
  if errorlevel 1 goto :fail
) else (
  call "%NODE_EXEC%" scripts\run-with-env.mjs "%NODE_RUNTIME%" run bootstrap:workflows
  if errorlevel 1 goto :fail
)

call "%NODE_EXEC%" scripts\run-with-env.mjs "%NODE_RUNTIME%" run start
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo StockPilot n8n could not start.
if not defined STOCKPILOT_NO_PAUSE pause
exit /b 1

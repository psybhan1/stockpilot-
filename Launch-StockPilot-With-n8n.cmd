@echo off
setlocal
cd /d "%~dp0"

set "STOCKPILOT_NO_PAUSE=1"
start "StockPilot n8n" cmd /k "cd /d ""%~dp0n8n"" && call Start-StockPilot-n8n.cmd"
timeout /t 8 >nul
call Launch-StockPilot.cmd

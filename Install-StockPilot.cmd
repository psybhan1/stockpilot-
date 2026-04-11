@echo off
setlocal
cd /d "%~dp0"

echo Installing StockPilot dependencies...
call npm.cmd install
if errorlevel 1 goto :fail

echo Preparing the local demo database...
call npm.cmd run setup:local -- --seed
if errorlevel 1 goto :fail

call npm.cmd run db:generate
if errorlevel 1 goto :fail

call npm.cmd run db:push
if errorlevel 1 goto :fail

call npm.cmd run db:seed
if errorlevel 1 goto :fail

echo.
echo StockPilot is installed.
echo Launch it any time with Launch-StockPilot.cmd
pause
exit /b 0

:fail
echo.
echo StockPilot setup failed.
pause
exit /b 1

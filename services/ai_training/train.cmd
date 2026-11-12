@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" goto usage
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0training-control.ps1" -Action "%~1" -Target "%~2" %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%

:usage
echo Usage:
echo   train.cmd start  vision
echo   train.cmd start  detector
echo   train.cmd start  detector -DetectorProfile fast-n
echo   train.cmd start  enose
echo   train.cmd run    detector
echo   train.cmd run    detector -DetectorProfile fast-n
echo   train.cmd run    all
echo   train.cmd run-resume detector
echo   train.cmd resume vision
echo   train.cmd stop   all
echo   train.cmd status all
exit /b 1

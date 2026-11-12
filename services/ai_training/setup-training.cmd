@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.10, 3.11, or 3.12, then run this command again.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 exit /b 1

call .venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 exit /b 1

if /I "%~1"=="cuda" (
  call .venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
  if errorlevel 1 exit /b 1
)

call .venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 exit /b 1

echo.
echo EcoChef AI training environment is ready.
echo Next: prepare-datasets.cmd
endlocal

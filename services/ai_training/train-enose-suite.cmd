@echo off
setlocal
cd /d "%~dp0"
set "ENOSE_ROOT=C:\Users\tanji\Desktop\Datasets\Electronic Nose Datasete"
if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Training environment not found. Run setup-training.cmd first.
  exit /b 1
)
echo Cleaning and training all supported e-nose specialist models...
".venv\Scripts\python.exe" "scripts\train_enose_suite.py" --root "%ENOSE_ROOT%" --output "runs\enose_models"
if errorlevel 1 exit /b %errorlevel%
echo.
echo Complete. See runs\enose_models\suite_report.json
endlocal

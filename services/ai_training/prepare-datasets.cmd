@echo off
setlocal
cd /d "%~dp0"

set "PYTHON=.venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo Training environment is missing. Run setup-training.cmd cuda first.
  exit /b 1
)

set "DETECTION_SOURCE=C:\Users\tanji\Desktop\Datasets\Food Detection"
set "FRESHNESS_SOURCE=C:\Users\tanji\Desktop\Datasets\Food Freshness"
set "ENOSE_SOURCE=C:\Users\tanji\Desktop\Datasets\Electronic Nose Datasete"
set "OUTPUT=%CD%\data\processed_v2"

"%PYTHON%" scripts\prepare_datasets_v2.py --detection-root "%DETECTION_SOURCE%" --freshness-root "%FRESHNESS_SOURCE%" --enose-root "%ENOSE_SOURCE%" --output "%OUTPUT%"
if errorlevel 1 exit /b 1
"%PYTHON%" scripts\validate_datasets.py --data "%OUTPUT%"
if errorlevel 1 exit /b 1

echo.
echo Cleaned data is ready in %OUTPUT%
endlocal

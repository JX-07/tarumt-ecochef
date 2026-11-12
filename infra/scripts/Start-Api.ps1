[CmdletBinding()]
param(
    [string]$HostAddress = '0.0.0.0',
    [switch]$SkipIngredientDetector
)

$ErrorActionPreference = 'Stop'

$apiRoot = Join-Path $PSScriptRoot '..\..\apps\api'
$python = Join-Path $apiRoot '.venv\Scripts\python.exe'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$detectorPython = Join-Path $repositoryRoot 'services\ai_training\.venv\Scripts\python.exe'
$detectorServer = Join-Path $repositoryRoot 'services\ml\ingredient_detection\server.py'
$detectorHealth = 'http://127.0.0.1:8001/health'
$detectorProcess = $null

if (-not (Test-Path -LiteralPath $python)) {
    throw 'API dependencies are not installed. Run: powershell -ExecutionPolicy Bypass -File infra/scripts/Setup-Api.ps1'
}

if (-not $SkipIngredientDetector) {
    $detectorReady = $false
    try {
        $health = Invoke-RestMethod -Uri $detectorHealth -TimeoutSec 2
        $detectorReady = $health.status -eq 'ready'
    }
    catch {
        $detectorReady = $false
    }

    if (-not $detectorReady -and (Test-Path -LiteralPath $detectorPython) -and (Test-Path -LiteralPath $detectorServer)) {
        $logDirectory = Join-Path $repositoryRoot 'services\ml\ingredient_detection\.logs'
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $detectorProcess = Start-Process -FilePath $detectorPython `
            -ArgumentList @($detectorServer, '--host', '127.0.0.1', '--port', '8001') `
            -WorkingDirectory $repositoryRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logDirectory 'server.log') `
            -RedirectStandardError (Join-Path $logDirectory 'server-error.log') `
            -PassThru

        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Start-Sleep -Milliseconds 500
            if ($detectorProcess.HasExited) { break }
            try {
                $health = Invoke-RestMethod -Uri $detectorHealth -TimeoutSec 2
                if ($health.status -eq 'ready') {
                    $detectorReady = $true
                    break
                }
            }
            catch {
                $detectorReady = $false
            }
        }
    }

    if ($detectorReady) {
        $env:INGREDIENT_DETECTION_API_URL = 'http://127.0.0.1:8001/v1/detect'
        Write-Host 'Ingredient detector ready: trained best.pt model will handle food scans.' -ForegroundColor Green
    }
    else {
        Write-Warning 'The trained ingredient detector could not start. Ingredient scans will use Gemini if configured.'
        $env:INGREDIENT_DETECTION_API_URL = ''
    }
}

Push-Location $apiRoot
try {
    & $python -m uvicorn app.main:app --reload --host $HostAddress --port 8000
}
finally {
    Pop-Location
    if ($null -ne $detectorProcess -and -not $detectorProcess.HasExited) {
        Stop-Process -Id $detectorProcess.Id -Force
    }
}

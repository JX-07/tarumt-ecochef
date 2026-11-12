[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$apiRoot = Join-Path $PSScriptRoot '..\..\apps\api'
$venvPath = Join-Path $apiRoot '.venv'
$python = Get-Command python -ErrorAction Stop

if (-not (Test-Path $venvPath)) {
    & $python.Source -m venv $venvPath
}

$venvPython = Join-Path $venvPath 'Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -e "$apiRoot[dev]"

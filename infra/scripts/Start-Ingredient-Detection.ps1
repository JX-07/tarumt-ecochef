[CmdletBinding()]
param(
    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 8001,
    [string]$Weights = ''
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$python = Join-Path $repositoryRoot 'services\ai_training\.venv\Scripts\python.exe'
$server = Join-Path $repositoryRoot 'services\ml\ingredient_detection\server.py'

if (-not (Test-Path -LiteralPath $python)) {
    throw 'AI dependencies are not installed. Run services\ai_training\setup-training.cmd cuda first.'
}

$arguments = @($server, '--host', $HostAddress, '--port', [string]$Port)
if ($Weights) {
    $resolvedWeights = (Resolve-Path -LiteralPath $Weights).Path
    $arguments += @('--weights', $resolvedWeights)
}

& $python @arguments

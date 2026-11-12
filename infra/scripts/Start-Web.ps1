[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$webRoot = Join-Path $PSScriptRoot '..\..\apps\web'
$next = Join-Path $webRoot 'node_modules\.bin\next.cmd'

if (-not (Test-Path $next)) {
    throw 'Web dependencies are not installed. Run pnpm install from the repository root first.'
}

Push-Location $webRoot
try {
    & $next dev
}
finally {
    Pop-Location
}

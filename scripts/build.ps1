[CmdletBinding()]
param(
    [Parameter()]
    [switch] $SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeToolchain

$repositoryRoot = Get-BookBridgeRoot
$extensionOutput = Join-Path -Path $repositoryRoot -ChildPath 'apps\extension\.output\chrome-mv3'
$webOutput = Join-Path -Path $repositoryRoot -ChildPath 'apps\web\dist'
$iconScript = Join-Path -Path $PSScriptRoot -ChildPath 'generate-icons.ps1'

Push-Location -LiteralPath $repositoryRoot
try {
    if (-not $SkipInstall) {
        Invoke-BookBridgeCommand -Command 'pnpm' -Arguments @('install', '--frozen-lockfile')
    }
    & $iconScript
    Invoke-BookBridgeCommand -Command 'pnpm' -Arguments @('build')
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $extensionOutput -PathType Container)) {
    throw "Extension build output is missing: $extensionOutput"
}
if (-not (Test-Path -LiteralPath $webOutput -PathType Container)) {
    throw "Web app build output is missing: $webOutput"
}

Write-Host 'BookBridge build completed.'
Write-Host "Chrome extension: $extensionOutput"
Write-Host "Web app: $webOutput"

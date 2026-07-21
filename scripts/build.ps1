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
$hostOutputDirectory = Join-Path -Path $repositoryRoot -ChildPath 'dist\native-host'
$hostExecutable = Join-Path -Path $hostOutputDirectory -ChildPath 'bookbridge-host.exe'
$extensionOutput = Join-Path -Path $repositoryRoot -ChildPath 'apps\extension\.output\chrome-mv3'

Push-Location -LiteralPath $repositoryRoot
try {
    if (-not $SkipInstall) {
        Invoke-BookBridgeCommand -Command 'pnpm' -Arguments @('install', '--frozen-lockfile')
    }

    Invoke-BookBridgeCommand -Command 'pnpm' -Arguments @(
        '--filter',
        '@bookbridge/extension',
        'build'
    )

    New-Item -ItemType Directory -Path $hostOutputDirectory -Force | Out-Null
    Invoke-BookBridgeCommand -Command 'go' -Arguments @(
        'build',
        '-trimpath',
        '-o',
        $hostExecutable,
        './apps/native-host/cmd/bookbridge-host'
    )
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
    throw "Native Host build output is missing: $hostExecutable"
}
if (-not (Test-Path -LiteralPath $extensionOutput -PathType Container)) {
    throw "Extension build output is missing: $extensionOutput"
}

Write-Host 'BookBridge build completed.'
Write-Host "Native Host: $hostExecutable"
Write-Host "Chrome extension: $extensionOutput"

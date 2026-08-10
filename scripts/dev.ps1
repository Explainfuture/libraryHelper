[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeToolchain
$repositoryRoot = Get-BookBridgeRoot

Push-Location -LiteralPath $repositoryRoot
try {
    Invoke-BookBridgeCommand -Command 'pnpm' -Arguments @(
        '--parallel',
        '--filter',
        '@bookbridge/web',
        '--filter',
        '@bookbridge/extension',
        'dev'
    )
}
finally {
    Pop-Location
}

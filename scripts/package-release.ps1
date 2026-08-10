[CmdletBinding()]
param(
    [Parameter()]
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows
Assert-BookBridgeToolchain

$repositoryRoot = Get-BookBridgeRoot
$identity = Get-BookBridgeExtensionIdentity
$buildScript = Join-Path -Path $PSScriptRoot -ChildPath 'build.ps1'
if (-not $SkipBuild) {
    & $buildScript -SkipInstall
}

$sourceExtension = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'apps\extension\.output\chrome-mv3')
)
if (-not (Test-Path -LiteralPath $sourceExtension -PathType Container)) {
    throw 'BookBridge extension build output is missing.'
}

$manifestPath = Join-Path -Path $sourceExtension -ChildPath 'manifest.json'
$manifest = [System.IO.File]::ReadAllText(
    $manifestPath,
    [System.Text.Encoding]::UTF8
) | ConvertFrom-Json
if ($manifest.key -ne $identity.manifestKey) {
    throw 'Packaged extension identity does not match BookBridge configuration.'
}

$releaseRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'dist\release')
)
$archivePath = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $releaseRoot -ChildPath 'BookBridge-extension.zip')
)
$releasePrefix = $releaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
if (-not $archivePath.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to package into an unexpected path: $archivePath"
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    Remove-Item -LiteralPath $archivePath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $sourceExtension,
    $archivePath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

Write-Host 'BookBridge extension package completed.' -ForegroundColor Green
Write-Host "Extension ID: $($identity.extensionId)"
Write-Host "Chrome Web Store / GitHub ZIP: $archivePath"
Write-Host 'GitHub users must extract the ZIP before choosing Load unpacked in Chrome.'

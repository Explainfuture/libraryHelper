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

$sourceExecutable = Join-Path `
    -Path $repositoryRoot `
    -ChildPath 'dist\native-host\bookbridge-host.exe'
$sourceExtension = Join-Path `
    -Path $repositoryRoot `
    -ChildPath 'apps\extension\.output\chrome-mv3'
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf) -or
    -not (Test-Path -LiteralPath $sourceExtension -PathType Container)) {
    throw 'BookBridge build output is incomplete. Run scripts\build.ps1 first.'
}

$releaseRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'dist\release')
)
$packageDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $releaseRoot -ChildPath 'BookBridge')
)
$archivePath = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $releaseRoot -ChildPath 'BookBridge-windows-x64.zip')
)
$releasePrefix = $releaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
foreach ($managedPath in @($packageDirectory, $archivePath)) {
    if (-not $managedPath.StartsWith(
            $releasePrefix,
            [StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to package into an unexpected path: $managedPath"
    }
}

if (Test-Path -LiteralPath $packageDirectory) {
    Remove-Item -LiteralPath $packageDirectory -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    Remove-Item -LiteralPath $archivePath -Force
}

$payloadDirectory = Join-Path -Path $packageDirectory -ChildPath 'payload'
$payloadExtension = Join-Path -Path $payloadDirectory -ChildPath 'extension'
$packageScripts = Join-Path -Path $packageDirectory -ChildPath 'scripts'
$packageConfig = Join-Path -Path $packageDirectory -ChildPath 'config'
New-Item -ItemType Directory -Path $payloadDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $packageScripts -Force | Out-Null
New-Item -ItemType Directory -Path $packageConfig -Force | Out-Null

Copy-Item -LiteralPath $sourceExecutable -Destination $payloadDirectory -Force
Copy-Item -LiteralPath $sourceExtension -Destination $payloadExtension -Recurse -Force
foreach ($scriptName in @(
        'common.ps1',
        'install-host.ps1',
        'set-firewall-private.ps1',
        'uninstall-host.ps1'
    )) {
    Copy-Item `
        -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath $scriptName) `
        -Destination $packageScripts `
        -Force
}
Copy-Item `
    -LiteralPath (Join-Path -Path $repositoryRoot -ChildPath 'config\extension-identity.json') `
    -Destination $packageConfig `
    -Force
foreach ($fileName in @(
        'Install BookBridge.cmd',
        'Uninstall BookBridge.cmd',
        'INSTALL.md',
        'LICENSE'
    )) {
    Copy-Item `
        -LiteralPath (Join-Path -Path $repositoryRoot -ChildPath $fileName) `
        -Destination $packageDirectory `
        -Force
}

$packagedManifestPath = Join-Path -Path $payloadExtension -ChildPath 'manifest.json'
$packagedManifest = [System.IO.File]::ReadAllText(
    $packagedManifestPath,
    [System.Text.Encoding]::UTF8
) | ConvertFrom-Json
if ($packagedManifest.key -ne $identity.manifestKey) {
    throw 'Packaged extension identity does not match BookBridge configuration.'
}

Compress-Archive `
    -LiteralPath $packageDirectory `
    -DestinationPath $archivePath `
    -CompressionLevel Optimal

Write-Host 'BookBridge release package completed.' -ForegroundColor Green
Write-Host "Extension ID: $($identity.extensionId)"
Write-Host "Folder: $packageDirectory"
Write-Host "Archive: $archivePath"

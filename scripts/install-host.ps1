[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string] $ExtensionId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows
Assert-BookBridgeToolchain

$repositoryRoot = Get-BookBridgeRoot
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installDirectory = Join-Path -Path $localAppData -ChildPath 'BookBridge'
$installedExecutable = Join-Path -Path $installDirectory -ChildPath 'bookbridge-host.exe'
$manifestPath = Join-Path -Path $installDirectory -ChildPath 'com.bookbridge.host.json'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bookbridge.host'
$buildScript = Join-Path -Path $PSScriptRoot -ChildPath 'build.ps1'
$builtExecutable = Join-Path -Path $repositoryRoot -ChildPath 'dist\native-host\bookbridge-host.exe'
$extensionOutput = Join-Path -Path $repositoryRoot -ChildPath 'apps\extension\.output\chrome-mv3'

if (-not $PSCmdlet.ShouldProcess($installDirectory, 'Build and install BookBridge Native Host')) {
    return
}

& $buildScript
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $builtExecutable -Destination $installedExecutable -Force

$manifestJson = New-BookBridgeNativeManifestJson `
    -ExtensionId $ExtensionId `
    -ExecutablePath $installedExecutable
Write-BookBridgeUtf8File -Path $manifestPath -Content $manifestJson

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host 'BookBridge Native Host installed for the current Windows user.'
Write-Host "Executable: $installedExecutable"
Write-Host "Manifest: $manifestPath"
Write-Host "Chrome extension: $extensionOutput"
Write-Host 'Next: reload the unpacked extension in chrome://extensions.'
Write-Host 'If Windows Firewall prompts, allow access on Private networks only.'

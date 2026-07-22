[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter()]
    [switch] $SkipBuild,

    [Parameter()]
    [switch] $NoLaunch,

    [Parameter(DontShow = $true)]
    [string] $InstallDirectoryOverride,

    [Parameter(DontShow = $true)]
    [string] $RegistryPathOverride
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows

$repositoryRoot = Get-BookBridgeRoot
$identity = Get-BookBridgeExtensionIdentity
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ($InstallDirectoryOverride) {
    $installDirectory = [System.IO.Path]::GetFullPath($InstallDirectoryOverride)
}
else {
    $installDirectory = [System.IO.Path]::GetFullPath(
        (Join-Path -Path $localAppData -ChildPath 'BookBridge')
    )
}
$installedExecutable = Join-Path -Path $installDirectory -ChildPath 'bookbridge-host.exe'
$installedExtension = Join-Path -Path $installDirectory -ChildPath 'extension'
$stagedExtension = Join-Path -Path $installDirectory -ChildPath 'extension.new'
$manifestPath = Join-Path -Path $installDirectory -ChildPath 'com.bookbridge.host.json'
if ($RegistryPathOverride) {
    if (-not $RegistryPathOverride.StartsWith(
            'HKCU:\Software\BookBridgeTests\',
            [StringComparison]::OrdinalIgnoreCase
        )) {
        throw 'A registry override must remain under HKCU:\Software\BookBridgeTests.'
    }
    $registryPath = $RegistryPathOverride
}
else {
    $registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bookbridge.host'
}
$buildScript = Join-Path -Path $PSScriptRoot -ChildPath 'build.ps1'

$installPrefix = $installDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
foreach ($managedPath in @($installedExecutable, $installedExtension, $stagedExtension, $manifestPath)) {
    $absoluteManagedPath = [System.IO.Path]::GetFullPath($managedPath)
    if (-not $absoluteManagedPath.StartsWith(
            $installPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to install to an unexpected path: $absoluteManagedPath"
    }
}

$payloadRoot = Join-Path -Path $repositoryRoot -ChildPath 'payload'
$payloadExecutable = Join-Path -Path $payloadRoot -ChildPath 'bookbridge-host.exe'
$payloadExtension = Join-Path -Path $payloadRoot -ChildPath 'extension'
$hasPackagedPayload =
    (Test-Path -LiteralPath $payloadExecutable -PathType Leaf) -and
    (Test-Path -LiteralPath $payloadExtension -PathType Container)

if (-not $PSCmdlet.ShouldProcess(
        $installDirectory,
        "Install BookBridge extension $($identity.extensionId) and Native Host"
    )) {
    return
}

if ($hasPackagedPayload) {
    $sourceExecutable = $payloadExecutable
    $sourceExtension = $payloadExtension
}
else {
    Assert-BookBridgeToolchain
    if (-not $SkipBuild) {
        & $buildScript
    }
    $sourceExecutable = Join-Path `
        -Path $repositoryRoot `
        -ChildPath 'dist\native-host\bookbridge-host.exe'
    $sourceExtension = Join-Path `
        -Path $repositoryRoot `
        -ChildPath 'apps\extension\.output\chrome-mv3'
}

if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
    throw "Native Host build output is missing: $sourceExecutable"
}
$sourceManifestPath = Join-Path -Path $sourceExtension -ChildPath 'manifest.json'
if (-not (Test-Path -LiteralPath $sourceManifestPath -PathType Leaf)) {
    throw "Extension build output is missing: $sourceExtension"
}
$sourceManifest = [System.IO.File]::ReadAllText(
    $sourceManifestPath,
    [System.Text.Encoding]::UTF8
) | ConvertFrom-Json
if ($sourceManifest.key -ne $identity.manifestKey) {
    throw 'The extension build does not contain the stable BookBridge identity.'
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceExecutable -Destination $installedExecutable -Force

if (Test-Path -LiteralPath $stagedExtension) {
    Remove-Item -LiteralPath $stagedExtension -Recurse -Force
}
Copy-Item `
    -LiteralPath $sourceExtension `
    -Destination $stagedExtension `
    -Recurse `
    -Force
if (Test-Path -LiteralPath $installedExtension) {
    Remove-Item -LiteralPath $installedExtension -Recurse -Force
}
Move-Item -LiteralPath $stagedExtension -Destination $installedExtension

$manifestJson = New-BookBridgeNativeManifestJson `
    -ExtensionId $identity.extensionId `
    -ExecutablePath $installedExecutable
Write-BookBridgeUtf8File -Path $manifestPath -Content $manifestJson

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host ''
Write-Host 'BookBridge is installed for the current Windows user.' -ForegroundColor Green
Write-Host "Extension ID: $($identity.extensionId)"
Write-Host "Extension folder: $installedExtension"
if (-not $NoLaunch) {
    $clipboardCommand = Get-Command -Name 'Set-Clipboard' -ErrorAction SilentlyContinue
    if ($null -ne $clipboardCommand) {
        Set-Clipboard -Value $installedExtension
        Write-Host 'The extension folder path has been copied to the clipboard.'
    }
}
Write-Host ''
Write-Host 'Chrome only requires these final clicks:' -ForegroundColor Cyan
Write-Host '1. Enable Developer mode on chrome://extensions'
Write-Host '2. Click Load unpacked and select the extension folder shown above'
Write-Host 'No Extension ID or Native Host command needs to be copied.'
Write-Host 'If Windows Firewall prompts, allow Private networks only.'

if (-not $NoLaunch) {
    $chromeCandidates = @(
        (Join-Path -Path $env:ProgramFiles -ChildPath 'Google\Chrome\Application\chrome.exe'),
        (Join-Path -Path ${env:ProgramFiles(x86)} -ChildPath 'Google\Chrome\Application\chrome.exe'),
        (Join-Path -Path $localAppData -ChildPath 'Google\Chrome\Application\chrome.exe')
    )
    $chromePath = $chromeCandidates | Where-Object {
        $_ -and (Test-Path -LiteralPath $_ -PathType Leaf)
    } | Select-Object -First 1
    if ($chromePath) {
        Start-Process -FilePath $chromePath -ArgumentList @('chrome://extensions')
    }
    Start-Process -FilePath 'explorer.exe' -ArgumentList @($installedExtension)
}

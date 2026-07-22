[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows

$repositoryRoot = Get-BookBridgeRoot
$identity = Get-BookBridgeExtensionIdentity
$distRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'dist')
)
$pathWord = -join @([char]0x8DEF, [char]0x5F84)
$releaseWord = -join @([char]0x53D1, [char]0x5E03)
$installWord = -join @([char]0x5B89, [char]0x88C5)
$targetWord = -join @([char]0x76EE, [char]0x6807)
$smokeRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $distRoot -ChildPath "install smoke $pathWord")
)
$distPrefix = $distRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
if (-not $smokeRoot.StartsWith(
        $distPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Refusing to use an unsafe install smoke directory: $smokeRoot"
}
if (Test-Path -LiteralPath $smokeRoot) {
    throw "Install smoke directory already exists: $smokeRoot"
}

$packageDirectory = Join-Path -Path $distRoot -ChildPath 'release\BookBridge'
$archivePath = Join-Path -Path $distRoot -ChildPath 'release\BookBridge-windows-x64.zip'
if (-not (Test-Path -LiteralPath $packageDirectory -PathType Container) -or
    -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw 'Packaged installer was not found. Run scripts\package-release.ps1 first.'
}
$smokePackageRoot = Join-Path -Path $smokeRoot -ChildPath "$releaseWord package"
$smokePackageDirectory = Join-Path -Path $smokePackageRoot -ChildPath 'BookBridge'
$smokeDirectory = Join-Path -Path $smokeRoot -ChildPath "$installWord $targetWord"
Expand-Archive `
    -LiteralPath $archivePath `
    -DestinationPath $smokePackageRoot `
    -Force
$installer = Join-Path -Path $smokePackageDirectory -ChildPath 'scripts\install-host.ps1'

$registryLeaf = [Guid]::NewGuid().ToString('N')
$registryPath = "HKCU:\Software\BookBridgeTests\$registryLeaf"
try {
    & $installer `
        -NoLaunch `
        -InstallDirectoryOverride $smokeDirectory `
        -RegistryPathOverride $registryPath

    $installedExecutable = Join-Path $smokeDirectory 'bookbridge-host.exe'
    $installedExtension = Join-Path $smokeDirectory 'extension'
    $nativeManifestPath = Join-Path $smokeDirectory 'com.bookbridge.host.json'
    $extensionManifestPath = Join-Path $installedExtension 'manifest.json'
    foreach ($requiredPath in @(
            $installedExecutable,
            $nativeManifestPath,
            $extensionManifestPath
        )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Packaged installer did not create: $requiredPath"
        }
    }

    $nativeManifest = [System.IO.File]::ReadAllText(
        $nativeManifestPath,
        [System.Text.Encoding]::UTF8
    ) | ConvertFrom-Json
    $extensionManifest = [System.IO.File]::ReadAllText(
        $extensionManifestPath,
        [System.Text.Encoding]::UTF8
    ) | ConvertFrom-Json
    $registeredManifest = (Get-Item -LiteralPath $registryPath).GetValue('')
    if ($nativeManifest.path -ne $installedExecutable -or
        @($nativeManifest.allowed_origins).Count -ne 1 -or
        $nativeManifest.allowed_origins[0] -ne
        "chrome-extension://$($identity.extensionId)/" -or
        $extensionManifest.key -ne $identity.manifestKey -or
        $registeredManifest -ne $nativeManifestPath) {
        throw 'Packaged installer produced inconsistent extension or Native Host registration.'
    }

    Write-Output "Packaged installer copied the stable extension to: $installedExtension"
    Write-Output "Native Host registration allows only: $($nativeManifest.allowed_origins[0])"
}
finally {
    if (Test-Path -LiteralPath $registryPath) {
        Remove-Item -LiteralPath $registryPath -Recurse -Force
    }
    if (Test-Path -LiteralPath $smokeRoot) {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force
    }
    $registryParent = 'HKCU:\Software\BookBridgeTests'
    if (Test-Path -LiteralPath $registryParent) {
        $remainingKeys = @(Get-ChildItem -LiteralPath $registryParent)
        if ($remainingKeys.Count -eq 0) {
            Remove-Item -LiteralPath $registryParent -Force
        }
    }
}

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows

$repositoryRoot = Get-BookBridgeRoot
$distRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'dist')
)
$testDirectoryName = -join @(
    [char]0x8DEF,
    [char]0x5F84,
    ' ',
    [char]0x542B,
    ' ',
    [char]0x7A7A,
    [char]0x683C
)
$testParent = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $distRoot -ChildPath $testDirectoryName)
)
$distPrefix = $distRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
if (-not $testParent.StartsWith($distPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use an unsafe path smoke-test directory: $testParent"
}
if (Test-Path -LiteralPath $testParent) {
    throw "Path smoke-test directory already exists: $testParent"
}

New-Item -ItemType Directory -Path $testParent -Force | Out-Null
$workspaceSuffix = -join @([char]0x5DE5, [char]0x4F5C, [char]0x533A)
$junctionPath = Join-Path -Path $testParent -ChildPath "BookBridge $workspaceSuffix"
New-Item -ItemType Junction -Path $junctionPath -Target $repositoryRoot | Out-Null

try {
    $buildScript = Join-Path -Path $junctionPath -ChildPath 'scripts\build.ps1'
    & $buildScript -SkipInstall
    $expectedExecutable = [System.IO.Path]::GetFullPath(
        (Join-Path -Path $junctionPath -ChildPath 'dist\native-host\bookbridge-host.exe')
    )
    $extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $manifest = New-BookBridgeNativeManifestJson `
        -ExtensionId $extensionId `
        -ExecutablePath $expectedExecutable | ConvertFrom-Json
    if ($manifest.path -ne $expectedExecutable) {
        throw "Manifest path changed during JSON round trip: $($manifest.path)"
    }
    $origins = @($manifest.allowed_origins)
    if ($origins.Count -ne 1 -or
        $origins[0] -ne "chrome-extension://$extensionId/") {
        throw "Manifest allowed_origins is not exact: $($origins -join ',')"
    }
    Write-Output "Build succeeded through path: $junctionPath"
    Write-Output "Manifest preserved executable path: $($manifest.path)"
}
finally {
    if (Test-Path -LiteralPath $junctionPath) {
        # Windows PowerShell 5.1 can throw a NullReferenceException when
        # Remove-Item targets a junction. Directory.Delete(false) removes only
        # the reparse point and never traverses into the repository target.
        [System.IO.Directory]::Delete($junctionPath, $false)
    }
    if (Test-Path -LiteralPath $testParent -PathType Container) {
        $remainingItems = @(Get-ChildItem -LiteralPath $testParent -Force)
        if ($remainingItems.Count -eq 0) {
            [System.IO.Directory]::Delete($testParent, $false)
        }
        else {
            Write-Warning "Preserved unexpected path smoke-test files in $testParent"
        }
    }
}

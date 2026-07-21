[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $localAppData -ChildPath 'BookBridge')
)
$expectedDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $localAppData -ChildPath 'BookBridge')
)
if (-not $installDirectory.Equals($expectedDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove an unexpected installation directory.'
}

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bookbridge.host'
$generatedFiles = @(
    (Join-Path -Path $installDirectory -ChildPath 'bookbridge-host.exe'),
    (Join-Path -Path $installDirectory -ChildPath 'com.bookbridge.host.json')
)

if ((Test-Path -LiteralPath $registryPath) -and
    $PSCmdlet.ShouldProcess($registryPath, 'Remove Native Messaging registration')) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force
}

foreach ($file in $generatedFiles) {
    if ((Test-Path -LiteralPath $file -PathType Leaf) -and
        $PSCmdlet.ShouldProcess($file, 'Remove BookBridge generated file')) {
        Remove-Item -LiteralPath $file -Force
    }
}

if (Test-Path -LiteralPath $installDirectory -PathType Container) {
    $remainingFiles = @(Get-ChildItem -LiteralPath $installDirectory -Force)
    if ($remainingFiles.Count -eq 0) {
        if ($PSCmdlet.ShouldProcess($installDirectory, 'Remove empty BookBridge directory')) {
            Remove-Item -LiteralPath $installDirectory -Force
        }
    }
    else {
        Write-Warning "Preserved non-generated files in $installDirectory"
    }
}

Write-Host 'BookBridge Native Host uninstall completed.'

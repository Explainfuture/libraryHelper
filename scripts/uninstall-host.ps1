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
$generatedDirectories = @(
    (Join-Path -Path $installDirectory -ChildPath 'extension'),
    (Join-Path -Path $installDirectory -ChildPath 'extension.new')
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

foreach ($directory in $generatedDirectories) {
    $absoluteDirectory = [System.IO.Path]::GetFullPath($directory)
    $installPrefix = $installDirectory.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $absoluteDirectory.StartsWith(
            $installPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to remove an unexpected directory: $absoluteDirectory"
    }
    if ((Test-Path -LiteralPath $absoluteDirectory -PathType Container) -and
        $PSCmdlet.ShouldProcess($absoluteDirectory, 'Remove BookBridge extension files')) {
        Remove-Item -LiteralPath $absoluteDirectory -Recurse -Force
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

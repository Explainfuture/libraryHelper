[CmdletBinding()]
param(
    [Parameter()]
    [ValidatePattern('^[a-p]{32}$')]
    [string] $ExtensionId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeToolchain

$repositoryRoot = Get-BookBridgeRoot
$hostSourceDirectory = Join-Path -Path $repositoryRoot -ChildPath 'apps\native-host'
$hostOutputDirectory = Join-Path -Path $repositoryRoot -ChildPath 'dist\native-host'
$hostExecutable = Join-Path -Path $hostOutputDirectory -ChildPath 'bookbridge-host.exe'

function Build-DevelopmentHost {
    New-Item -ItemType Directory -Path $hostOutputDirectory -Force | Out-Null
    Push-Location -LiteralPath $repositoryRoot
    try {
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
}

function Get-GoSourceSignature {
    $sourceFiles = @(
        Get-ChildItem -LiteralPath $hostSourceDirectory -Filter '*.go' -File -Recurse |
            Sort-Object -Property FullName
    )
    return ($sourceFiles | ForEach-Object {
            "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)"
        }) -join ';'
}

Build-DevelopmentHost
$lastSourceSignature = Get-GoSourceSignature

if ($ExtensionId) {
    Assert-BookBridgeWindows
    $manifestPath = Join-Path -Path $hostOutputDirectory -ChildPath 'com.bookbridge.host.json'
    $registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bookbridge.host'
    $manifest = [ordered]@{
        name = 'com.bookbridge.host'
        description = 'BookBridge EPUB transfer host (development)'
        path = $hostExecutable
        type = 'stdio'
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
    Write-BookBridgeUtf8File `
        -Path $manifestPath `
        -Content ($manifest | ConvertTo-Json -Depth 4)
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $manifestPath
    Write-Host "Registered development Native Host for extension $ExtensionId"
}

$pnpmCommand = Get-Command -Name 'pnpm.cmd' -ErrorAction SilentlyContinue
if ($null -eq $pnpmCommand) {
    $pnpmCommand = Get-Command -Name 'pnpm' -ErrorAction Stop
}

Write-Host "Development Native Host built at $hostExecutable"
Write-Host 'Chrome starts the registered Native Host when the extension connects.'
Write-Host 'Watching Go sources while WXT runs. Press Ctrl+C to stop.'

# WXT is the interactive development process, so its output remains visible in
# the current terminal while this script rebuilds the Go executable on changes.
$wxtProcess = Start-Process `
    -FilePath $pnpmCommand.Source `
    -ArgumentList @('--filter', '@bookbridge/extension', 'dev') `
    -WorkingDirectory $repositoryRoot `
    -NoNewWindow `
    -PassThru

try {
    while (-not $wxtProcess.HasExited) {
        Start-Sleep -Seconds 1
        $wxtProcess.Refresh()
        $sourceSignature = Get-GoSourceSignature
        if ($sourceSignature -ne $lastSourceSignature) {
            try {
                Build-DevelopmentHost
                $lastSourceSignature = $sourceSignature
                Write-Host 'Rebuilt the development Native Host.'
            }
            catch {
                Write-Warning "Native Host rebuild failed: $($_.Exception.Message)"
            }
        }
    }

    if ($wxtProcess.ExitCode -ne 0) {
        throw "WXT exited with code $($wxtProcess.ExitCode)."
    }
}
finally {
    if (-not $wxtProcess.HasExited) {
        Stop-Process -Id $wxtProcess.Id
    }
    $wxtProcess.Dispose()
}

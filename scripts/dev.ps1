[CmdletBinding()]
param(
    [Parameter()]
    [ValidatePattern('^[a-p]{32}$')]
    [string] $ExtensionId,

    [Parameter()]
    [switch] $SmokeTest
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

function Stop-DevelopmentProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [int] $RootProcessId
    )

    $processes = @(Get-CimInstance Win32_Process)
    $pendingIds = New-Object System.Collections.Generic.Queue[int]
    $descendantIds = New-Object System.Collections.Generic.List[int]
    $pendingIds.Enqueue($RootProcessId)
    while ($pendingIds.Count -gt 0) {
        $parentId = $pendingIds.Dequeue()
        foreach ($process in $processes) {
            if ($process.ParentProcessId -eq $parentId) {
                $childId = [int]$process.ProcessId
                $pendingIds.Enqueue($childId)
                $descendantIds.Add($childId)
            }
        }
    }
    $orderedIds = @($descendantIds)
    [array]::Reverse($orderedIds)
    foreach ($processId in $orderedIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

Build-DevelopmentHost
$lastSourceSignature = Get-GoSourceSignature

if ($ExtensionId) {
    Assert-BookBridgeWindows
    $manifestPath = Join-Path -Path $hostOutputDirectory -ChildPath 'com.bookbridge.host.json'
    $registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bookbridge.host'
    $manifestJson = New-BookBridgeNativeManifestJson `
        -ExtensionId $ExtensionId `
        -ExecutablePath $hostExecutable `
        -Description 'BookBridge EPUB transfer host (development)'
    Write-BookBridgeUtf8File `
        -Path $manifestPath `
        -Content $manifestJson
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

$developmentManifest = Join-Path `
    -Path $repositoryRoot `
    -ChildPath 'apps\extension\.output\chrome-mv3-dev\manifest.json'
$smokeStartedAt = [DateTime]::UtcNow
$smokeDeadline = $smokeStartedAt.AddSeconds(30)
$smokePassed = $false
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

        if ($SmokeTest -and
            (Test-Path -LiteralPath $developmentManifest -PathType Leaf) -and
            (Get-Item -LiteralPath $developmentManifest).LastWriteTimeUtc -ge $smokeStartedAt -and
            (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
            $smokePassed = $true
            Write-Output "WXT development manifest: $developmentManifest"
            Write-Output "Go development host: $hostExecutable"
            break
        }
        if ($SmokeTest -and [DateTime]::UtcNow -ge $smokeDeadline) {
            throw 'Development smoke test timed out waiting for WXT output.'
        }
    }

    if ($SmokeTest -and -not $smokePassed) {
        throw 'WXT exited before the development smoke test completed.'
    }
    if (-not $SmokeTest -and $wxtProcess.ExitCode -ne 0) {
        throw "WXT exited with code $($wxtProcess.ExitCode)."
    }
}
finally {
    if (-not $wxtProcess.HasExited) {
        Stop-DevelopmentProcessTree -RootProcessId $wxtProcess.Id
    }
    $wxtProcess.Dispose()
}

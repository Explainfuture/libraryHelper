Set-StrictMode -Version Latest

$script:BookBridgeRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $PSScriptRoot -ChildPath '..')
)

function Get-BookBridgeRoot {
    return $script:BookBridgeRoot
}

function Assert-BookBridgeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    if ($null -eq (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Assert-BookBridgeToolchain {
    Assert-BookBridgeCommand -Name 'go'
    Assert-BookBridgeCommand -Name 'node'
    Assert-BookBridgeCommand -Name 'pnpm'
}

function Assert-BookBridgeWindows {
    if ($env:OS -ne 'Windows_NT') {
        throw 'This script supports Windows only.'
    }
}

function Invoke-BookBridgeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,

        [Parameter()]
        [string[]] $Arguments = @()
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command '$Command' failed with exit code $LASTEXITCODE."
    }
}

function Write-BookBridgeUtf8File {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Content
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function New-BookBridgeNativeManifestJson {
    param(
        [Parameter(Mandatory = $true)]
        [ValidatePattern('^[a-p]{32}$')]
        [string] $ExtensionId,

        [Parameter(Mandatory = $true)]
        [string] $ExecutablePath,

        [Parameter()]
        [string] $Description = 'BookBridge EPUB transfer host'
    )

    $absoluteExecutablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
    $manifest = [ordered]@{
        name = 'com.bookbridge.host'
        description = $Description
        path = $absoluteExecutablePath
        type = 'stdio'
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
    return $manifest | ConvertTo-Json -Depth 4
}

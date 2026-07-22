Set-StrictMode -Version Latest

$script:BookBridgeRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $PSScriptRoot -ChildPath '..')
)

function Get-BookBridgeRoot {
    return $script:BookBridgeRoot
}

function ConvertTo-BookBridgeExtensionId {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ManifestKey
    )

    try {
        $publicKey = [Convert]::FromBase64String($ManifestKey)
    }
    catch {
        throw 'The BookBridge manifest key is not valid base64.'
    }
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha256.ComputeHash($publicKey)
    }
    finally {
        $sha256.Dispose()
    }

    $characters = New-Object char[] 32
    for ($index = 0; $index -lt 16; $index += 1) {
        $characters[$index * 2] = [char]([int][char]'a' + ($digest[$index] -shr 4))
        $characters[($index * 2) + 1] = [char]([int][char]'a' + ($digest[$index] -band 15))
    }
    return -join $characters
}

function Get-BookBridgeExtensionIdentity {
    $identityPath = Join-Path `
        -Path $script:BookBridgeRoot `
        -ChildPath 'config\extension-identity.json'
    if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) {
        throw "BookBridge extension identity was not found: $identityPath"
    }
    $identity = [System.IO.File]::ReadAllText(
        $identityPath,
        [System.Text.Encoding]::UTF8
    ) | ConvertFrom-Json
    if ($identity.extensionId -notmatch '^[a-p]{32}$' -or
        -not $identity.manifestKey) {
        throw 'BookBridge extension identity is invalid.'
    }
    $derivedId = ConvertTo-BookBridgeExtensionId -ManifestKey $identity.manifestKey
    if ($derivedId -ne $identity.extensionId) {
        throw "BookBridge extension identity mismatch: expected $($identity.extensionId), derived $derivedId"
    }
    return $identity
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

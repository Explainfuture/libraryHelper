[CmdletBinding()]
param(
    [Parameter()]
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This optional firewall hardening script must be run as Administrator.'
}

$localAppData = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData
)
$installedExecutable = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $localAppData -ChildPath 'BookBridge\bookbridge-host.exe')
)
if (-not $Remove -and -not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
    throw "The installed BookBridge executable was not found: $installedExecutable"
}

$applicationFilters = @(
    Get-NetFirewallApplicationFilter |
        Where-Object {
            $_.Program -and
            ([System.IO.Path]::GetFullPath($_.Program)).Equals(
                $installedExecutable,
                [StringComparison]::OrdinalIgnoreCase
            )
        }
)
$rules = @($applicationFilters | Get-NetFirewallRule)
if ($rules.Count -eq 0) {
    if ($Remove) {
        Write-Output 'No BookBridge firewall rules were found.'
        return
    }
    throw 'No Windows Firewall application rules were found for BookBridge.'
}

$unexpectedRules = @(
    $rules |
        Where-Object {
            $_.Direction -ne 'Inbound' -or
            $_.Action -ne 'Allow'
        }
)
if ($unexpectedRules.Count -gt 0) {
    throw 'Refusing to modify an unexpected BookBridge firewall rule.'
}

if ($Remove) {
    $rules | Remove-NetFirewallRule
    $remainingRules = @(
        Get-NetFirewallApplicationFilter |
            Where-Object {
                $_.Program -and
                ([System.IO.Path]::GetFullPath($_.Program)).Equals(
                    $installedExecutable,
                    [StringComparison]::OrdinalIgnoreCase
                )
            } |
            Get-NetFirewallRule
    )
    if ($remainingRules.Count -gt 0) {
        throw 'One or more BookBridge firewall rules remain after removal.'
    }
    Write-Output "Removed $($rules.Count) BookBridge firewall rule(s)."
    return
}

$rules | Set-NetFirewallRule -Profile Private
$verifiedRules = @($applicationFilters | Get-NetFirewallRule)
$notPrivate = @($verifiedRules | Where-Object { $_.Profile -ne 'Private' })
if ($notPrivate.Count -gt 0) {
    throw 'One or more BookBridge firewall rules are not limited to Private networks.'
}

Write-Output "Restricted $($verifiedRules.Count) BookBridge firewall rule(s) to Private networks."

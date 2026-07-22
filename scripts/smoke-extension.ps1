[CmdletBinding()]
param(
    [Parameter()]
    [switch] $SkipBuild,

    [Parameter()]
    [string] $ChromePath,

    [Parameter()]
    [string] $ScreenshotDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows
Assert-BookBridgeCommand -Name 'pnpm'
Assert-BookBridgeCommand -Name 'node'

$repositoryRoot = Get-BookBridgeRoot
$distRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'dist')
)
$smokeRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $distRoot -ChildPath 'chrome-extension-smoke')
)
$distPrefix = $distRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
if (-not $smokeRoot.StartsWith($distPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use an unsafe smoke-test directory: $smokeRoot"
}

$playwrightRoot = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'ms-playwright'
$playwrightChromes = @()
if (Test-Path -LiteralPath $playwrightRoot -PathType Container) {
    $playwrightChromes = @(Get-ChildItem -LiteralPath $playwrightRoot -Directory -Filter 'chromium-*' |
            Sort-Object -Property Name -Descending |
            ForEach-Object {
                Join-Path -Path $_.FullName -ChildPath 'chrome-win64\chrome.exe'
            })
}
$chromeCandidates = @($playwrightChromes)
$googleChromeRoots = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:LOCALAPPDATA
)
foreach ($googleChromeRoot in $googleChromeRoots) {
    if ($googleChromeRoot) {
        $chromeCandidates += Join-Path `
            -Path $googleChromeRoot `
            -ChildPath 'Google\Chrome\Application\chrome.exe'
    }
}
if (-not $ChromePath) {
    $ChromePath = $chromeCandidates | Where-Object {
        $_ -and (Test-Path -LiteralPath $_ -PathType Leaf)
    } | Select-Object -First 1
}
if (-not $ChromePath -or -not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) {
    throw 'A Chromium or Google Chrome executable was not found.'
}

if (-not $SkipBuild) {
    Push-Location -LiteralPath $repositoryRoot
    try {
        Invoke-BookBridgeCommand -Command 'pnpm' -Arguments @(
            '--filter',
            '@bookbridge/extension',
            'build'
        )
    }
    finally {
        Pop-Location
    }
}

$builtExtensionPath = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'apps\extension\.output\chrome-mv3')
)
if (-not (Test-Path -LiteralPath $builtExtensionPath -PathType Container)) {
    throw "Built extension was not found: $builtExtensionPath"
}

$manifestPath = Join-Path -Path $builtExtensionPath -ChildPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Built extension manifest was not found: $manifestPath"
}
$manifestJson = [System.IO.File]::ReadAllText(
    $manifestPath,
    [System.Text.Encoding]::UTF8
)
$manifest = $manifestJson | ConvertFrom-Json
$identity = Get-BookBridgeExtensionIdentity
if ($manifest.key -ne $identity.manifestKey) {
    throw 'The built extension is missing its stable BookBridge identity.'
}
$expectedPermissions = @(
    'downloads',
    'nativeMessaging',
    'notifications',
    'storage',
    'windows'
)
$actualPermissions = @($manifest.permissions | Sort-Object)
$sortedExpectedPermissions = @($expectedPermissions | Sort-Object)
if (($actualPermissions -join ',') -ne ($sortedExpectedPermissions -join ',')) {
    throw "Unexpected extension permissions: $($actualPermissions -join ', ')"
}
if ($manifest.PSObject.Properties.Name -contains 'host_permissions') {
    throw 'The built extension must not declare host_permissions.'
}
if ($manifest.manifest_version -ne 3 -or
    $manifest.background.service_worker -ne 'background.js' -or
    $manifest.action.default_popup -ne 'popup.html') {
    throw 'The built extension manifest is missing the expected MV3 entry points.'
}
foreach ($iconSize in @(16, 32, 48, 128)) {
    $iconName = "icons/icon-$iconSize.png"
    if ($manifest.icons."$iconSize" -ne $iconName -or
        -not (Test-Path -LiteralPath (Join-Path $builtExtensionPath $iconName) -PathType Leaf)) {
        throw "The built extension is missing its $iconSize px PNG icon."
    }
}

if (Test-Path -LiteralPath $smokeRoot) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
}
$extensionPath = Join-Path -Path $smokeRoot -ChildPath 'extension'
Copy-Item `
    -LiteralPath $builtExtensionPath `
    -Destination $extensionPath `
    -Recurse `
    -Force
$smokeManifestPath = Join-Path -Path $extensionPath -ChildPath 'manifest.json'
$smokeManifest = [System.IO.File]::ReadAllText(
    $smokeManifestPath,
    [System.Text.Encoding]::UTF8
) | ConvertFrom-Json
$smokeManifest.PSObject.Properties.Remove('key')
Write-BookBridgeUtf8File `
    -Path $smokeManifestPath `
    -Content ($smokeManifest | ConvertTo-Json -Depth 12)
$profilePath = Join-Path -Path $smokeRoot -ChildPath 'profile'
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
$standardOutputPath = Join-Path -Path $smokeRoot -ChildPath 'chrome.stdout.log'
$standardErrorPath = Join-Path -Path $smokeRoot -ChildPath 'chrome.stderr.log'

$arguments = @(
    '--disable-gpu',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=-32000,-32000',
    '--window-size=420,560',
    '--remote-debugging-port=0',
    ('--user-data-dir="{0}"' -f $profilePath),
    ('--disable-extensions-except="{0}"' -f $extensionPath),
    ('--load-extension="{0}"' -f $extensionPath),
    'about:blank'
)

$chromeProcess = Start-Process `
    -FilePath $ChromePath `
    -ArgumentList $arguments `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $standardOutputPath `
    -RedirectStandardError $standardErrorPath

$succeeded = $false
try {
    $activePortPath = Join-Path -Path $profilePath -ChildPath 'DevToolsActivePort'
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $activePortPath -PathType Leaf)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Chrome did not start CDP. See $standardErrorPath"
        }
        Start-Sleep -Milliseconds 200
    }

    $portLines = @(Get-Content -LiteralPath $activePortPath)
    $port = [int]$portLines[0]
    $serviceWorkers = @()
    do {
        $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list"
        $serviceWorkers = @()
        foreach ($target in $targets) {
            if ($target.type -eq 'service_worker' -and
                $target.url -like 'chrome-extension://*/background.js') {
                $serviceWorkers += $target
            }
        }
        if ($serviceWorkers.Count -eq 0) {
            Start-Sleep -Milliseconds 250
        }
    } while ($serviceWorkers.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)

    if ($serviceWorkers.Count -eq 0) {
        throw "BookBridge service worker did not load. See $standardErrorPath"
    }

    $worker = $serviceWorkers | Select-Object -First 1
    $workerURL = [string]($worker.url | Select-Object -First 1)
    if (-not $workerURL) {
        $workerDetails = $worker | ConvertTo-Json -Depth 6 -Compress
        throw "Chrome returned a service worker without a URL: $workerDetails"
    }
    if ($workerURL -notmatch '^chrome-extension://([a-p]{32})/background\.js$') {
        throw "Chrome returned an invalid service worker URL: $workerURL"
    }
    $extensionId = $Matches[1]

    $popupURL = "chrome-extension://$extensionId/popup.html"
    $encodedPopupURL = [uri]::EscapeDataString($popupURL)
    $null = Invoke-RestMethod `
        -Method Put `
        -Uri "http://127.0.0.1:$port/json/new?$encodedPopupURL"
    $popupTargets = @()
    $popupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 200
        $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list"
        $popupTargets = @()
        foreach ($target in $targets) {
            if ($target.url -eq $popupURL) {
                $popupTargets += $target
            }
        }
    } while ($popupTargets.Count -eq 0 -and [DateTime]::UtcNow -lt $popupDeadline)
    if ($popupTargets.Count -eq 0) {
        throw "BookBridge popup did not load. See $standardErrorPath"
    }

    $uiSmokeScript = Join-Path `
        -Path $repositoryRoot `
        -ChildPath 'scripts\smoke-extension-ui.mjs'
    $uiSmokeArguments = @(
        $uiSmokeScript,
        [string]$port,
        $extensionId
    )
    if ($ScreenshotDirectory) {
        if ([System.IO.Path]::IsPathRooted($ScreenshotDirectory)) {
            $resolvedScreenshotDirectory = [System.IO.Path]::GetFullPath(
                $ScreenshotDirectory
            )
        }
        else {
            $resolvedScreenshotDirectory = [System.IO.Path]::GetFullPath(
                (Join-Path -Path $repositoryRoot -ChildPath $ScreenshotDirectory)
            )
        }
        New-Item `
            -ItemType Directory `
            -Path $resolvedScreenshotDirectory `
            -Force | Out-Null
        $uiSmokeArguments += $resolvedScreenshotDirectory
    }
    Invoke-BookBridgeCommand -Command 'node' -Arguments $uiSmokeArguments

    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version"
    Write-Output "Executable: $ChromePath"
    Write-Output "Chrome: $($version.Browser)"
    Write-Output "Source manifest: stable production identity with exact minimal permissions and PNG icons"
    Write-Output "Isolated smoke Extension ID: $extensionId"
    Write-Output "Service worker: $workerURL"
    Write-Output "Popup: $($popupTargets[0].title) ($($popupTargets[0].url))"
    $succeeded = $true
}
finally {
    $profilePattern = [Regex]::Escape($profilePath)
    $temporaryChromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
            Where-Object { $_.CommandLine -match $profilePattern })
    foreach ($temporaryChromeProcess in $temporaryChromeProcesses) {
        Stop-Process -Id $temporaryChromeProcess.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if (-not $chromeProcess.HasExited) {
        Stop-Process -Id $chromeProcess.Id -Force -ErrorAction SilentlyContinue
    }
    $chromeProcess.Dispose()

    if ($succeeded -and (Test-Path -LiteralPath $smokeRoot)) {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force
    }
}

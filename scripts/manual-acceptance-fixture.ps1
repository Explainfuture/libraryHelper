[CmdletBinding(DefaultParameterSetName = 'Start')]
param(
    [Parameter(ParameterSetName = 'Stop', Mandatory = $true)]
    [switch] $Stop,

    [Parameter(ParameterSetName = 'Start')]
    [ValidateRange(1024, 65535)]
    [int] $Port = 18765
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Assert-BookBridgeWindows

$repositoryRoot = Get-BookBridgeRoot
$distRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath 'dist')
)
$fixtureDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $distRoot -ChildPath 'manual-acceptance')
)
$distPrefix = $distRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
if (-not $fixtureDirectory.StartsWith($distPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use an unsafe fixture directory: $fixtureDirectory"
}

$pidPath = Join-Path -Path $fixtureDirectory -ChildPath 'server.pid'
if ($Stop) {
    if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
        Write-Output 'Manual acceptance fixture server is not recorded as running.'
        return
    }
    $serverPid = [int]([System.IO.File]::ReadAllText($pidPath).Trim())
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
    $expectedDirectoryPattern = [Regex]::Escape($fixtureDirectory)
    if ($null -eq $serverProcess -or
        $serverProcess.Name -notmatch '^node(\.exe)?$' -or
        $serverProcess.CommandLine -notmatch 'manual-acceptance-server\.mjs' -or
        $serverProcess.CommandLine -notmatch $expectedDirectoryPattern) {
        throw "Refusing to stop process $serverPid because it is not the recorded fixture server."
    }
    Stop-Process -Id $serverPid -Force
    Remove-Item -LiteralPath $pidPath -Force
    Write-Output "Stopped manual acceptance fixture server $serverPid."
    return
}

Assert-BookBridgeCommand -Name 'node'
New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null

if (Test-Path -LiteralPath $pidPath -PathType Leaf) {
    $recordedPid = [int]([System.IO.File]::ReadAllText($pidPath).Trim())
    $recordedProcess = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
    if ($null -ne $recordedProcess) {
        throw "A recorded fixture server is already running as process $recordedPid."
    }
    Remove-Item -LiteralPath $pidPath -Force
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use."
}

$fixtureName = 'bookbridge-release-test.epub'
$epubPath = Join-Path -Path $fixtureDirectory -ChildPath $fixtureName
if (Test-Path -LiteralPath $epubPath -PathType Leaf) {
    Remove-Item -LiteralPath $epubPath -Force
}

Add-Type -AssemblyName System.IO.Compression
$fileStream = [System.IO.File]::Open(
    $epubPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
)
try {
    $archive = New-Object System.IO.Compression.ZipArchive(
        $fileStream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $true
    )
    try {
        $entries = [ordered]@{
            'mimetype' = 'application/epub+zip'
            'META-INF/container.xml' = '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
            'OEBPS/content.opf' = '<?xml version="1.0" encoding="UTF-8"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">bookbridge-release-test</dc:identifier><dc:title>BookBridge Release Test</dc:title><dc:language>en</dc:language></metadata><manifest/><spine/></package>'
        }
        foreach ($entryName in $entries.Keys) {
            $entry = $archive.CreateEntry(
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $entryStream = $entry.Open()
            $writer = New-Object System.IO.StreamWriter(
                $entryStream,
                (New-Object System.Text.UTF8Encoding($false))
            )
            try {
                $writer.Write([string]$entries[$entryName])
            }
            finally {
                $writer.Dispose()
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $fileStream.Dispose()
}

$landingPath = Join-Path -Path $fixtureDirectory -ChildPath 'index.html'
$landingHTML = @'
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <title>BookBridge release acceptance</title>
  <body>
    <main>
      <h1>BookBridge release acceptance</h1>
      <p>This generated EPUB contains test metadata and no book content.</p>
      <a href="bookbridge-release-test.epub" download>Download test EPUB</a>
    </main>
  </body>
</html>
'@
$utf8WithoutBOM = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($landingPath, $landingHTML, $utf8WithoutBOM)

$standardOutputPath = Join-Path -Path $fixtureDirectory -ChildPath 'http.stdout.log'
$standardErrorPath = Join-Path -Path $fixtureDirectory -ChildPath 'http.stderr.log'
$nodeCommand = Get-Command -Name 'node' -ErrorAction Stop
$serverScript = Join-Path -Path $PSScriptRoot -ChildPath 'manual-acceptance-server.mjs'
$serverProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList @(
        $serverScript,
        [string]$Port,
        $fixtureDirectory
    ) `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $standardOutputPath `
    -RedirectStandardError $standardErrorPath
[System.IO.File]::WriteAllText(
    $pidPath,
    [string]$serverProcess.Id,
    [System.Text.Encoding]::ASCII
)

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    Start-Sleep -Milliseconds 100
    $listener = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue
} while ($null -eq $listener -and [DateTime]::UtcNow -lt $deadline)
if ($null -eq $listener) {
    throw "Fixture server did not start. See $standardErrorPath"
}

$fixture = Get-Item -LiteralPath $epubPath
[pscustomobject]@{
    ServerPID = $serverProcess.Id
    URL = "http://127.0.0.1:$Port/"
    Fixture = $fixture.FullName
    FixtureSize = $fixture.Length
    FixtureSHA256 = (Get-FileHash -LiteralPath $epubPath -Algorithm SHA256).Hash
}

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path -Path $PSScriptRoot -ChildPath 'common.ps1')

Add-Type -AssemblyName System.Drawing

$repositoryRoot = Get-BookBridgeRoot
$outputDirectory = Join-Path -Path $repositoryRoot -ChildPath 'apps\extension\public\icons'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function New-RoundedRectanglePath {
    param(
        [Parameter(Mandatory = $true)]
        [float] $Width,

        [Parameter(Mandatory = $true)]
        [float] $Height,

        [Parameter(Mandatory = $true)]
        [float] $Radius
    )

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $path.AddArc($Width - $diameter, 0, $diameter, $diameter, 270, 90)
    $path.AddArc($Width - $diameter, $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc(0, $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-LeftPagePath {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddLine(28, 32, 58, 32)
    $path.AddBezier(58, 32, 67, 32, 74, 39, 74, 48)
    $path.AddLine(74, 48, 74, 98)
    $path.AddBezier(74, 98, 69, 93, 63, 91, 56, 91)
    $path.AddLine(56, 91, 28, 91)
    $path.CloseFigure()
    return $path
}

function New-RightPagePath {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddLine(100, 32, 70, 32)
    $path.AddBezier(70, 32, 61, 32, 54, 39, 54, 48)
    $path.AddLine(54, 48, 54, 98)
    $path.AddBezier(54, 98, 59, 93, 65, 91, 72, 91)
    $path.AddLine(72, 91, 100, 91)
    $path.CloseFigure()
    return $path
}

foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = New-Object System.Drawing.Bitmap(
        $size,
        $size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = [float]$size / 128
        $graphics.ScaleTransform($scale, $scale)

        $backgroundPath = New-RoundedRectanglePath -Width 128 -Height 128 -Radius 28
        $leftPagePath = New-LeftPagePath
        $rightPagePath = New-RightPagePath
        $backgroundBrush = New-Object System.Drawing.SolidBrush(
            [System.Drawing.ColorTranslator]::FromHtml('#173f35')
        )
        $leftPageBrush = New-Object System.Drawing.SolidBrush(
            [System.Drawing.ColorTranslator]::FromHtml('#f5efe2')
        )
        $rightPageBrush = New-Object System.Drawing.SolidBrush(
            [System.Drawing.ColorTranslator]::FromHtml('#d6a85f')
        )
        $bridgePen = New-Object System.Drawing.Pen(
            [System.Drawing.ColorTranslator]::FromHtml('#173f35'),
            8
        )
        try {
            $bridgePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $bridgePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $graphics.FillPath($backgroundBrush, $backgroundPath)
            $graphics.FillPath($leftPageBrush, $leftPagePath)
            $graphics.FillPath($rightPageBrush, $rightPagePath)
            $graphics.DrawLine($bridgePen, 42, 62, 86, 62)
        }
        finally {
            $bridgePen.Dispose()
            $rightPageBrush.Dispose()
            $leftPageBrush.Dispose()
            $backgroundBrush.Dispose()
            $rightPagePath.Dispose()
            $leftPagePath.Dispose()
            $backgroundPath.Dispose()
        }

        $outputPath = Join-Path -Path $outputDirectory -ChildPath "icon-$size.png"
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host "Generated $outputPath"
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

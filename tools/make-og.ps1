Add-Type -AssemblyName System.Drawing

$w = 1200; $h = 630
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

function Hex($s) { [System.Drawing.ColorTranslator]::FromHtml($s) }

# Warm cream base
$g.Clear((Hex '#fff8f0'))

# Soft radial glows (the aurora, frozen)
function Glow($cx, $cy, $rx, $ry, $hex, $alpha) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse($cx - $rx, $cy - $ry, 2 * $rx, 2 * $ry)
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush($p)
  $c = Hex $hex
  $b.CenterColor = [System.Drawing.Color]::FromArgb($alpha, $c)
  $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $c))
  $g.FillEllipse($b, $cx - $rx, $cy - $ry, 2 * $rx, 2 * $ry)
  $b.Dispose(); $p.Dispose()
}
Glow 240 40 620 420 '#ffe9cf' 235
Glow 1120 420 560 430 '#ffd9e0' 210
Glow 620 660 500 300 '#ffe2c4' 150

# Brand gradient brush over a rect
function GradBrush($rect) {
  $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (Hex '#ffc83d'), (Hex '#ff5470'), 35.0, $true)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
  $blend.Colors = @((Hex '#ffc83d'), (Hex '#ff8a3d'), (Hex '#ff5470'))
  $blend.Positions = [float[]]@(0, 0.52, 1)
  $b.InterpolationColors = $blend
  $b
}

# Butterfly (traced from the site's SVG, 24-unit box), scaled + offset
function ButterflyPath($s, $ox, $oy) {
  $L = New-Object System.Drawing.Drawing2D.GraphicsPath
  # left wing
  $pts = @(
    @(12,5.5), @(11,3.9),  @(9.3,2.9),  @(7.4,2.9),
               @(4.9,2.9), @(3,4.8),    @(3,7.2),
               @(3,9.4),   @(4.5,10.8), @(6.4,11.6),
               @(4.4,12),  @(3,13.2),   @(3,15.2),
               @(3,17.3),  @(4.7,18.9), @(6.8,18.9),
               @(9.1,18.9),@(11,17.3),  @(12,15.1)
  )
  $P = $pts | ForEach-Object { New-Object System.Drawing.PointF(($_[0] * $s + $ox), ($_[1] * $s + $oy)) }
  $L.AddBezier($P[0],$P[1],$P[2],$P[3]); $L.AddBezier($P[3],$P[4],$P[5],$P[6])
  $L.AddBezier($P[6],$P[7],$P[8],$P[9]); $L.AddBezier($P[9],$P[10],$P[11],$P[12])
  $L.AddBezier($P[12],$P[13],$P[14],$P[15]); $L.AddBezier($P[15],$P[16],$P[17],$P[18])
  $L.CloseFigure()
  # right wing = mirror of left around x=12
  $R = New-Object System.Drawing.Drawing2D.GraphicsPath
  $Q = $pts | ForEach-Object { New-Object System.Drawing.PointF(((24 - $_[0]) * $s + $ox), ($_[1] * $s + $oy)) }
  $R.AddBezier($Q[0],$Q[1],$Q[2],$Q[3]); $R.AddBezier($Q[3],$Q[4],$Q[5],$Q[6])
  $R.AddBezier($Q[6],$Q[7],$Q[8],$Q[9]); $R.AddBezier($Q[9],$Q[10],$Q[11],$Q[12])
  $R.AddBezier($Q[12],$Q[13],$Q[14],$Q[15]); $R.AddBezier($Q[15],$Q[16],$Q[17],$Q[18])
  $R.CloseFigure()
  @($L, $R)
}

$bs = 3.4; $bx = 600 - 12 * $bs; $by = 88   # butterfly centered (x=12 is the glyph's midline)
$wings = ButterflyPath $bs $bx $by
$bRect = New-Object System.Drawing.RectangleF($bx, $by, (24 * $bs), (24 * $bs))
$gb = GradBrush $bRect
$g.FillPath($gb, $wings[0])
# right wing slightly translucent, like the logo
$tex = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bRect, [System.Drawing.Color]::FromArgb(184, (Hex '#ffc83d')), [System.Drawing.Color]::FromArgb(184, (Hex '#ff5470')), 35.0, $true)
$blend2 = New-Object System.Drawing.Drawing2D.ColorBlend(3)
$blend2.Colors = @([System.Drawing.Color]::FromArgb(184,(Hex '#ffc83d')), [System.Drawing.Color]::FromArgb(184,(Hex '#ff8a3d')), [System.Drawing.Color]::FromArgb(184,(Hex '#ff5470')))
$blend2.Positions = [float[]]@(0, 0.52, 1)
$tex.InterpolationColors = $blend2
$g.FillPath($tex, $wings[1])
$g.FillEllipse($gb, ($bx + (12 - 1.5) * $bs), ($by + (4.4 - 1.5) * $bs), (3 * $bs), (3 * $bs))

# "Evolution" wordmark in script face, gradient fill
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$wordPath = New-Object System.Drawing.Drawing2D.GraphicsPath
# Script letters overlap where they join; even-odd fill punches holes there.
$wordPath.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
$wordRect = New-Object System.Drawing.RectangleF(0, 168, $w, 110)
$ff = New-Object System.Drawing.FontFamily('Segoe Script')
$wordPath.AddString('Evolution', $ff, [int][System.Drawing.FontStyle]::Bold, 78, $wordRect, $fmt)
$wb = GradBrush ($wordPath.GetBounds())
$g.FillPath($wb, $wordPath)

# Headline
$ink = New-Object System.Drawing.SolidBrush(Hex '#3d1a10')
$hlPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$hlPath.FillMode = [System.Drawing.Drawing2D.FillMode]::Winding
$hlRect = New-Object System.Drawing.RectangleF(60, 300, ($w - 120), 160)
$ffui = New-Object System.Drawing.FontFamily('Segoe UI')
$nl = [Environment]::NewLine
$hlPath.AddString(("The AI COO" + $nl + "for your ecommerce store"), $ffui, [int][System.Drawing.FontStyle]::Bold, 62, $hlRect, $fmt)
$g.FillPath($ink, $hlPath)

# Subline
$dot = [string][char]0x00B7
$sub = New-Object System.Drawing.SolidBrush(Hex '#7a5b4d')
$subFont = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Regular)
$subRect = New-Object System.Drawing.RectangleF(60, 478, ($w - 120), 50)
$g.DrawString("Free store audit  $dot  fixes ranked by dollar impact  $dot  you pay only if it works", $subFont, $sub, $subRect, $fmt)

# Domain, bottom center, muted
$mut = New-Object System.Drawing.SolidBrush(Hex '#a9968b')
$mutFont = New-Object System.Drawing.Font('Segoe UI Semibold', 17)
$mutRect = New-Object System.Drawing.RectangleF(60, 560, ($w - 120), 40)
$g.DrawString('www.runevolution.io', $mutFont, $mut, $mutRect, $fmt)

$g.Dispose()
$out = 'D:\company\shop-avatar\public\og.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved: $out"

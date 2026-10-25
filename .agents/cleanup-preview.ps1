$root = 'E:\codex目录\codex任务仪表盘'
$names = @(
  'card-after.png',
  'card-final.png',
  'page-after.png',
  'popover.png',
  'popover-page.png',
  'shot-closed.png',
  'shot-open.png',
  'gemini-code-1792722415063.html'
)
foreach ($name in $names) {
  $path = Join-Path -LiteralPath $root -ChildPath $name
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
$desktopShot = 'C:\Users\LYNX\Desktop\gemini-code-before.png'
if (Test-Path -LiteralPath $desktopShot) { Remove-Item -LiteralPath $desktopShot -Force }
Get-ChildItem -LiteralPath $root -File | Select-Object -ExpandProperty Name

# TokenLens 官方 Codex 启动配置：让 Codex 正常启动时自动打开本地 CDP 端口。
#
# 官方 Codex 没有前端扩展点（app.asar 里没有 user_scripts），tokenlens.js 只能靠
# CDP 注入，而 CDP 必须先有调试端口。
#
# 两种开端口的方式：
#   A. BUILD_FLAVOR=dev + CODEX_ELECTRON_CHROMIUM_SWITCHES（环境变量）
#      -> 缺点：Dev flavor 被官方排除在应用内更新器之外（app.asar 的白名单是
#         [Nightly, InternalAlpha, PublicBeta, Prod]），更新器不再运行。
#   B. MSIX 执行别名 chatgpt-desktop.exe + 命令行开关（**本脚本采用**）
#      -> 优点：仍是 prod flavor，应用内更新器照常工作（enableUpdater=true）。
#
# B 的关键：MSIX 的 <desktop:ExecutionAlias Alias="chatgpt-desktop.exe" />
# 是真实可执行入口（%LOCALAPPDATA%\Microsoft\WindowsApps 下），带参数有效；
# 而 AUMID 激活（shell:AppsFolder\...!App、开始菜单、任务栏）会忽略参数。
# 所以桌面快捷方式要指向这个执行别名，图标和体验不变。
#
# 撤销：pwsh -ExecutionPolicy Bypass -File .\standalone\setup-launcher.ps1 -Uninstall

[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$aliasName = 'chatgpt-desktop.exe'
$aliasPath = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\$aliasName"
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "ChatGPT.lnk"
$backupPath = Join-Path $desktop "ChatGPT.lnk.bak-tokenlens"

$switches = @(
  "--remote-debugging-address=127.0.0.1"
  "--remote-debugging-port=9229"
  "--remote-allow-origins=*"
) -join ' '

if ($Uninstall) {
  if (Test-Path -LiteralPath $backupPath) {
    Copy-Item -LiteralPath $backupPath -Destination $shortcutPath -Force
    Remove-Item -LiteralPath $backupPath -Force
    Write-Host '已还原桌面的 ChatGPT.lnk。'
  }
  [Environment]::SetEnvironmentVariable("BUILD_FLAVOR", $null, "User")
  [Environment]::SetEnvironmentVariable("CODEX_ELECTRON_CHROMIUM_SWITCHES", $null, "User")
  Write-Host "已清空 BUILD_FLAVOR 与 CODEX_ELECTRON_CHROMIUM_SWITCHES（若之前设过）。"
  Write-Host '重启 Codex 后完全恢复默认行为。'
  return
}

if (-not (Test-Path -LiteralPath $aliasPath)) {
  throw "MSIX execution alias not found: $aliasPath"
}

# 备份原快捷方式（只备份一次）
if (-not (Test-Path -LiteralPath $backupPath) -and (Test-Path -LiteralPath $shortcutPath)) {
  Copy-Item -LiteralPath $shortcutPath -Destination $backupPath -Force
}

# 桌面快捷方式指向执行别名并带上调试端口参数
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $aliasPath
$shortcut.Arguments = $switches
$shortcut.WorkingDirectory = $env:LOCALAPPDATA
$shortcut.IconLocation = "$aliasPath,0"
$shortcut.Description = 'ChatGPT (Codex) with a local debug port for TokenLens'
$shortcut.Save()

Write-Host '已配置桌面快捷方式：'
Write-Host ('  ' + $shortcutPath)
Write-Host ('  -> ' + $aliasPath)
Write-Host ('  args: ' + $switches)
Write-Host ''
Write-Host '之后双击桌面的 ChatGPT 图标启动 Codex，调试端口会自动打开，'
Write-Host '后台宿主会自行附着并注入 TokenLens。'
Write-Host ''
Write-Host '注意：开始菜单 / 任务栏的 Codex 项走 AUMID 激活，会忽略参数，'
Write-Host '      那样开的端口没有 TokenLens。需要带插件就用桌面图标启动。'
Write-Host ''
Write-Host '撤销：pwsh -ExecutionPolicy Bypass -File .\standalone\setup-launcher.ps1 -Uninstall'

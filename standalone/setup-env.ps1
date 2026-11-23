# TokenLens 官方 Codex 环境配置：让 Codex 正常启动时自动打开本地 CDP 端口。
#
# 官方 Codex 没有任何前端扩展点（app.asar 里没有 user_scripts），tokenlens.js 只能靠
# CDP 注入，而 CDP 必须先有调试端口。官方的开关入口只有一个：
#
#   CODEX_ELECTRON_CHROMIUM_SWITCHES  -- 官方在 app.asar 里读它并 app.commandLine.appendSwitch
#
# 它被硬绑在 BUILD_FLAVOR=dev 上（asar 原文：if(e!==p.x.Dev||!a)return[]），
# 所以必须同时设 BUILD_FLAVOR=dev。
#
# dev flavor 的两个副作用（已实测确认）：
#   1. app-server 的库换成 .codex\sqlite\codex-dev.db
#      -- 里面是 169 条完整线程目录，比 prod 的 codex.db（14 条近期）更全，不丢历史。
#   2. 应用内自动更新（Sparkle / Windows Store updater）关闭
#      -- 官方 asar：shouldIncludeWindowsUpdater 只在 prod/beta/nightly 等 flavor 启用。
#      微软商店的更新入口不受影响。
#
# 撤销：powershell -ExecutionPolicy Bypass -File .\standalone\setup-env.ps1 -Uninstall

[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$switches = @{
  "remote-debugging-address" = "127.0.0.1"
  "remote-debugging-port"    = "9229"
  "remote-allow-origins"     = "*"
} | ConvertTo-Json -Compress

$flavorName = "BUILD_FLAVOR"
$switchName = "CODEX_ELECTRON_CHROMIUM_SWITCHES"

if ($Uninstall) {
  [Environment]::SetEnvironmentVariable($flavorName, $null, "User")
  [Environment]::SetEnvironmentVariable($switchName, $null, "User")
  Write-Host "已撤销：BUILD_FLAVOR 与 CODEX_ELECTRON_CHROMIUM_SWITCHES 已清空。"
  Write-Host "重启 Codex 后恢复默认行为（无调试端口，TokenLens 不注入）。"
  return
}

# 记录原值，撤销时精确还原
$statePath = Join-Path $PSScriptRoot "env-state.json"
if (-not (Test-Path -LiteralPath $statePath)) {
  $previous = @{
    BUILD_FLAVOR = [Environment]::GetEnvironmentVariable($flavorName, "User")
    CODEX_ELECTRON_CHROMIUM_SWITCHES = [Environment]::GetEnvironmentVariable($switchName, "User")
  }
  $previous | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

[Environment]::SetEnvironmentVariable($flavorName, "dev", "User")
[Environment]::SetEnvironmentVariable($switchName, $switches, "User")

Write-Host "已设置用户级环境变量："
Write-Host ("  " + $flavorName + " = " + [Environment]::GetEnvironmentVariable($flavorName, "User"))
Write-Host ("  " + $switchName + " = " + [Environment]::GetEnvironmentVariable($switchName, "User"))
Write-Host ""
Write-Host "之后正常启动 Codex（开始菜单 / 桌面图标）即可，调试端口会自动打开，"
Write-Host "TokenLens 宿主会自行附着并注入。"
Write-Host ""
Write-Host "注意：需要重启 Codex 才生效（环境变量在进程启动时读取）。"
Write-Host "撤销：powershell -ExecutionPolicy Bypass -File .\standalone\setup-env.ps1 -Uninstall"

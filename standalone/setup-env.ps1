# TokenLens 官方 Codex 环境配置：让 Codex 以任意方式启动时都自动打开本地 CDP 端口。
#
# 官方 Codex 没有前端扩展点（app.asar 里没有 user_scripts），tokenlens.js 只能靠
# CDP 注入，而 CDP 必须先有调试端口。官方只有一个开关入口，app.asar 原文：
#
#   let a = env.CODEX_ELECTRON_CHROMIUM_SWITCHES?.trim();
#   if (buildFlavor !== Dev || !a) return [];        // 只有 Dev 才读这个变量
#
# 所以必须同时设 BUILD_FLAVOR=dev。端口值必须是字符串（数字会被拒绝）。
#
# 代价（2026-11-23 用户已确认接受）：
#   应用内更新器停摆。官方 app.asar 里更新器白名单是
#   f = [Nightly, InternalAlpha, PublicBeta, Prod]，不含 Dev；
#   门控 g = (e,t,r,n) => "false" !== n.CODEX_SPARKLE_ENABLED && f.includes(e) && t === r
#   => enableUpdater=false。这不是本脚本关的，是 Dev flavor 的设计结果。
#   微软商店的更新不受影响（应用是 MSIX 包，由商店与 Windows 负责）。
#
# 另一个副作用（实测）：app-server 的库换成 .codex\sqlite\codex-dev.db，
# 里面是 169 条完整线程目录，比 prod 的 codex.db（14 条近期）更全，不丢历史。
#
# 撤销：pwsh -ExecutionPolicy Bypass -File .\standalone\setup-env.ps1 -Uninstall

[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$flavorName = "BUILD_FLAVOR"
$switchName = "CODEX_ELECTRON_CHROMIUM_SWITCHES"
$statePath = Join-Path $PSScriptRoot "env-state.json"

$switches = @{
  "remote-debugging-address" = "127.0.0.1"
  "remote-debugging-port"    = "9229"
  # 宿主用 Node 内置 WebSocket，握手不带 Origin（Chromium 只在有 Origin 时才校验白名单），
  # 所以这里放行的是本机页面 Origin；写成 "*" 等于让任意网页都能连 ws://127.0.0.1:9229 接管渲染进程。
  "remote-allow-origins"     = "http://127.0.0.1"
} | ConvertTo-Json -Compress

if ($Uninstall) {
  # 安装时把原值存进了 env-state.json，卸载必须按它还原，否则用户自己配过的值永久丢失。
  $restored = $false
  if (Test-Path -LiteralPath $statePath) {
    try {
      $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
      [Environment]::SetEnvironmentVariable($flavorName, $previous.BUILD_FLAVOR, "User")
      [Environment]::SetEnvironmentVariable($switchName, $previous.CODEX_ELECTRON_CHROMIUM_SWITCHES, "User")
      $restored = $true
    } catch {
      Write-Host "env-state.json 读取失败，按清空处理：" $_.Exception.Message
    }
    Remove-Item -LiteralPath $statePath -Force
  }
  if (-not $restored) {
    [Environment]::SetEnvironmentVariable($flavorName, $null, "User")
    [Environment]::SetEnvironmentVariable($switchName, $null, "User")
  }
  Write-Host "已撤销：BUILD_FLAVOR 与 CODEX_ELECTRON_CHROMIUM_SWITCHES 已还原为安装前的值。"
  Write-Host "重启 Codex 后恢复默认行为（无调试端口，TokenLens 不注入）。"
  return
}

# 记录原值，撤销时可精确还原。
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
Write-Host ("  " + $flavorName + " = dev")
Write-Host ("  " + $switchName + " = " + $switches)
Write-Host ""
Write-Host "之后用任意方式启动 Codex（开始菜单、桌面图标、任务栏、codex:// 都行），"
Write-Host "调试端口都会自动打开，TokenLens 宿主会自行附着并注入。"
Write-Host ""
Write-Host "注意：需要重启 Codex 才生效（环境变量在进程启动时读取）。"
Write-Host "代价：应用内更新停摆（Dev flavor 不在官方更新器白名单里），微软商店更新照常。"
Write-Host "撤销：pwsh -ExecutionPolicy Bypass -File .\standalone\setup-env.ps1 -Uninstall"

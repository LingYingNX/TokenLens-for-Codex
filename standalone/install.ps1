# TokenLens 官方 Codex 安装器：配置环境变量（让 Codex 正常启动时自带调试端口）+ 注册后台宿主。
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$hostScript = Join-Path $root "tokenlens-host.mjs"
$setupEnv = Join-Path $root "setup-env.ps1"
$taskName = "TokenLens Host"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "TokenLens Codex.lnk"

# 选一个现代 PowerShell 来跑子脚本。
# PS 5.1（powershell.exe）按 ANSI 读无 BOM 的 UTF-8，中文会乱码并把引号配对搞错，
# 所以优先用 pwsh（PS 7）。BOM 已经让 PS 5.1 也能正确读，但调用端同样该用现代 shell。
function Get-PreferredShell {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) { return $pwsh.Source }
  return "powershell.exe"
}

$shell = Get-PreferredShell

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
  & $shell -NoProfile -ExecutionPolicy Bypass -File $setupEnv -Uninstall | Out-Null
  Write-Host "已卸载：计划任务、桌面快捷方式与环境变量都已清理。"
  return
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw "missing tokenlens-host.mjs" }
if (-not (Test-Path -LiteralPath $setupEnv)) { throw "missing setup-env.ps1" }

# 1. 环境变量：让 Codex 正常启动时自动打开本地 CDP 端口。
& $shell -NoProfile -ExecutionPolicy Bypass -File $setupEnv | Out-Host

# 2. 后台宿主：登录后常驻，等 Codex 起来就附着注入。
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe not found (Node.js missing or not in PATH)" }

$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $hostScript)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = "PT30S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "Installed:"
Write-Host ("  Env vars -> Codex opens the debug port on normal launch")
Write-Host ("  Scheduled task: " + $taskName)
Write-Host ""
Write-Host "Usage: start Codex normally (Start menu / desktop icon). TokenLens injects itself in the background."
Write-Host "Restart Codex if it is already running, so it picks up the new environment variables."

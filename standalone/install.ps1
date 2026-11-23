# TokenLens 官方 Codex 安装器：配置启动方式（让 Codex 正常启动时自带调试端口）+ 注册后台宿主。
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$hostScript = Join-Path $root "tokenlens-host.mjs"
$setupLauncher = Join-Path $root "setup-launcher.ps1"
$taskName = "TokenLens Host"

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
  & $shell -NoProfile -ExecutionPolicy Bypass -File $setupLauncher -Uninstall | Out-Host
  Write-Host "已卸载：计划任务、桌面快捷方式与启动配置都已还原。"
  return
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw "missing tokenlens-host.mjs" }
if (-not (Test-Path -LiteralPath $setupLauncher)) { throw "missing setup-launcher.ps1" }

# 1. 启动配置：桌面图标指向 MSIX 执行别名并带调试端口参数。
#    保持 prod flavor，应用内更新器照常工作。
& $shell -NoProfile -ExecutionPolicy Bypass -File $setupLauncher | Out-Host

# 2. 后台宿主：常驻等待 Codex。
#    只用 AtLogOnce 的话有两个问题：宿主崩一次就再也不起来；不重新登录就不会跑。
#    所以加两个触发器：登录时跑一次（延迟 30 秒），之后每分钟拉一次。
#    宿主本身常驻，重复触发是幂等的；MultipleInstances=IgnoreNew 保证不会起多个。
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe not found (Node.js missing or not in PATH)" }

$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $hostScript)

$logon = New-ScheduledTaskTrigger -AtLogOn
$logon.Delay = "PT30S"

# 每分钟重复一次，不设时长 = 无限重复。
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $repeat) -Settings $settings -Force | Out-Null

Write-Host "Installed:"
Write-Host ("  Desktop shortcut -> MSIX execution alias with the debug port; prod flavor, in-app updater stays on")
Write-Host ("  Scheduled task: " + $taskName + " (logon + every minute)")
Write-Host ""
Write-Host "Usage: double-click the desktop ChatGPT icon. TokenLens injects itself in the background."

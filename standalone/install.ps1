# TokenLens 官方 Codex 安装器：配置环境变量（任意方式启动都开调试端口）+ 注册后台宿主。
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$hostScript = Join-Path $root "tokenlens-host.mjs"
$setupEnv = Join-Path $root "setup-env.ps1"
$vbsLauncher = Join-Path $root "tokenlens-host.vbs"
$taskName = "TokenLens Host"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "ChatGPT.lnk"
$shortcutBackup = Join-Path $desktop "ChatGPT.lnk.bak-tokenlens"

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
  # 计划任务只管拉起，不管收尸；已经常驻的宿主会活到注销，必须自己清掉。
  # 只按命令行匹配本仓库的宿主脚本，绝不碰 Codex。
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*tokenlens-host.mjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # 桌面快捷方式若被改过就还原成官方原样。
  if (Test-Path -LiteralPath $shortcutBackup) {
    Copy-Item -LiteralPath $shortcutBackup -Destination $shortcutPath -Force
    Remove-Item -LiteralPath $shortcutBackup -Force
    Write-Host "桌面快捷方式已还原为官方原样。"
  }
  & $shell -NoProfile -ExecutionPolicy Bypass -File $setupEnv -Uninstall | Out-Null
  Write-Host "已卸载：计划任务、桌面快捷方式与环境变量都已清理。"
  return
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw "missing tokenlens-host.mjs" }
if (-not (Test-Path -LiteralPath $setupEnv)) { throw "missing setup-env.ps1" }
if (-not (Test-Path -LiteralPath $vbsLauncher)) { throw "missing tokenlens-host.vbs" }

# 0. 桌面快捷方式保持官方原样（B 方案靠环境变量开端口，任何入口都有效，不需要改快捷方式）。
if (Test-Path -LiteralPath $shortcutBackup) {
  Copy-Item -LiteralPath $shortcutBackup -Destination $shortcutPath -Force
  Remove-Item -LiteralPath $shortcutBackup -Force
  Write-Host "桌面快捷方式已还原为官方原样（不再需要启动参数）。"
}

# 1. 环境变量：让 Codex 以任意方式启动时都自动打开本地 CDP 端口。
& $shell -NoProfile -ExecutionPolicy Bypass -File $setupEnv | Out-Host

# 2. 后台宿主：常驻等待 Codex。
#    只用 AtLogOnce 的话有两个问题：宿主崩一次就再也不起来；不重新登录就不会跑。
#    所以加两个触发器：登录时跑一次（延迟 30 秒），之后每分钟当看门狗拉一次。
#    重复触发不是幂等的：wscript 拉起后立刻返回，任务实例活不过 1 秒，
#    MultipleInstances=IgnoreNew 看不到活实例，结果就是每分钟多一个常驻 node。
#    单实例由 tokenlens-host.vbs 自己查 Win32_Process 挡住（并且改为等待宿主退出）。
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe not found (Node.js missing or not in PATH)" }

# 用 wscript.exe 拉起 .vbs，由 VBScript 以隐藏窗口启动 node —— 直接让计划任务跑
# node.exe 会在桌面弹出一个控制台黑窗口。wscript.exe 是 GUI 子系统程序，不会。
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
if (-not (Test-Path -LiteralPath $wscript)) { throw "wscript.exe not found" }

$action = New-ScheduledTaskAction -Execute $wscript -Argument ('//B "{0}"' -f $vbsLauncher)

$logon = New-ScheduledTaskTrigger -AtLogOn
$logon.Delay = "PT30S"

# 每分钟重复一次，不设时长 = 无限重复。
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $repeat) -Settings $settings -Force | Out-Null

Write-Host "Installed:"
Write-Host ("  Env vars -> Codex opens the debug port no matter how it is launched")
Write-Host ("  Scheduled task: " + $taskName + " (logon + every minute)")
Write-Host ""
Write-Host "Usage: start Codex any way you like (Start menu, desktop icon, taskbar, codex://)."
Write-Host "Restart Codex if it is already running, so it picks up the new environment variables."

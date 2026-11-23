# TokenLens standalone 安装器：注册登录自启任务 + 桌面快捷方式。
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$hostScript = Join-Path $root "tokenlens-host.ps1"
$launcher = Join-Path $root "start-tokenlens.cmd"
$taskName = "TokenLens Standalone Host"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "TokenLens Codex.lnk"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
  Write-Host "已卸载：计划任务与桌面快捷方式已删除。"
  return
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw "缺少 tokenlens-host.ps1" }
if (-not (Test-Path -LiteralPath $launcher)) { throw "缺少 start-tokenlens.cmd" }

$shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $shell) { $shell = (Get-Command powershell -ErrorAction SilentlyContinue).Source }
if (-not $shell) { throw "找不到 PowerShell 可执行文件" }

$action = New-ScheduledTaskAction -Execute $shell -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`" -NoLaunch" -f $hostScript)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = "PT20S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = "启动 Codex 并注入 TokenLens"
$shortcut.Save()

Write-Host "已安装："
Write-Host ("  计划任务 " + $taskName + "（登录后 20 秒以 -NoLaunch 附加）")
Write-Host ("  桌面快捷方式 " + $shortcutPath + "（会带调试端口重启 Codex）")
Write-Host ""
Write-Host "首次使用：关掉 Codex，然后双击桌面快捷方式。"
# TokenLens official Codex host installer: desktop shortcut + logon autostart (attach only, never restarts Codex).
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$hostScript = Join-Path $root "tokenlens-host.mjs"
$launcher = Join-Path $root "start-tokenlens.cmd"
$taskName = "TokenLens Host"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "TokenLens Codex.lnk"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
  Write-Host "Uninstalled: scheduled task and desktop shortcut removed."
  return
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw "missing tokenlens-host.mjs" }
if (-not (Test-Path -LiteralPath $launcher)) { throw "missing start-tokenlens.cmd" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe not found (Node.js missing or not in PATH)" }

$action = New-ScheduledTaskAction -Execute $node -Argument ("`"{0}`"" -f $hostScript)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = "PT30S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Start Codex and inject the TokenLens throughput status line"
$shortcut.Save()

Write-Host "Installed:"
Write-Host ("  Desktop shortcut " + $shortcutPath)
Write-Host ("  Scheduled task " + $taskName + " (attaches to a running Codex 30s after logon)")
Write-Host ""
Write-Host "First run: double-click the desktop shortcut TokenLens Codex."

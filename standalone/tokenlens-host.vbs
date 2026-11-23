' 无窗口启动 TokenLens 官方 Codex 宿主（node tokenlens-host.mjs）。
'
' 计划任务、以及双击 start-tokenlens.cmd，最终都走这里。
' wscript.exe 是 GUI 子系统程序，用 WshShell.Run 的窗口样式 0 启动 node，
' 所以不会再弹出 node 的控制台黑窗口。
'
' 日志照旧写到 tokenlens-host.log（node 宿主自己负责）。
Option Explicit

Dim fso, shell, here, hostScript, nodeExe, command, preferred
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
hostScript = fso.BuildPath(here, "tokenlens-host.mjs")

If Not fso.FileExists(hostScript) Then
  WScript.Quit 2
End If

' 优先用 Program Files 里的 node，找不到再交给 PATH 解析。
preferred = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If fso.FileExists(preferred) Then
  nodeExe = preferred
Else
  nodeExe = "node.exe"
End If

command = """" & nodeExe & """ """ & hostScript & """"
' 0 = 隐藏窗口，False = 不等待退出
shell.Run command, 0, False

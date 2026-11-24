' 无窗口启动 TokenLens 官方 Codex 宿主（node tokenlens-host.mjs）。
'
' 计划任务、以及双击 start-tokenlens.cmd，最终都走这里。
' wscript.exe 是 GUI 子系统程序，用 WshShell.Run 的窗口样式 0 启动 node，
' 所以不会再弹出 node 的控制台黑窗口。
'
' 日志照旧写到 tokenlens-host.log（node 宿主自己负责）。
'
' 单实例：计划任务每分钟触发一次当看门狗用，靠这里挡住重复启动。
' 只在 WshShell.Run 处等待是不够的——计划任务的 MultipleInstances 只看任务实例，
' 而 VBS 自己瞬间就退出了；所以启动前先查一遍有没有已经在跑的宿主。
Option Explicit

Dim fso, shell, here, hostScript, nodeExe, command, preferred, code, wmi, procs, proc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
hostScript = fso.BuildPath(here, "tokenlens-host.mjs")

If Not fso.FileExists(hostScript) Then
  WScript.Quit 2
End If

' 已经在跑就直接退出。查不到（WMI 不可用）时按「没在跑」处理，宁可多一个也不能不起。
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
If Not procs Is Nothing Then
  For Each proc In procs
    If InStr(LCase(proc.CommandLine & ""), "tokenlens-host.mjs") > 0 Then
      WScript.Quit 0
    End If
  Next
End If
On Error GoTo 0

' 优先用 Program Files 里的 node，找不到再交给 PATH 解析。
preferred = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If fso.FileExists(preferred) Then
  nodeExe = preferred
Else
  nodeExe = "node.exe"
End If

command = """" & nodeExe & """ """ & hostScript & """"
' 0 = 隐藏窗口，True = 等宿主退出。等待让计划任务实例的寿命等于宿主寿命，
' MultipleInstances=IgnoreNew 才有意义，也不会每分钟多留一个 node。
code = shell.Run(command, 0, True)
WScript.Quit code

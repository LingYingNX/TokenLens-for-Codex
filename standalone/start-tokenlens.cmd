@echo off
setlocal
set "HERE=%~dp0"

rem 交给 VBScript 无窗口启动 node，避免弹出控制台黑窗口。
if not exist "%HERE%tokenlens-host.vbs" (
  echo Missing tokenlens-host.vbs
  pause
  exit /b 1
)

rem VBS 现在会等宿主退出（单实例靠它），所以用 start 脱离，别让 cmd 窗口挂到宿主结束。
start "" wscript.exe //B "%HERE%tokenlens-host.vbs"
endlocal

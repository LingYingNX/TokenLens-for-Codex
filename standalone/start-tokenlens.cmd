@echo off
setlocal
set "HERE=%~dp0"

rem 交给 VBScript 无窗口启动 node，避免弹出控制台黑窗口。
if not exist "%HERE%tokenlens-host.vbs" (
  echo Missing tokenlens-host.vbs
  pause
  exit /b 1
)

wscript.exe //B "%HERE%tokenlens-host.vbs"
endlocal

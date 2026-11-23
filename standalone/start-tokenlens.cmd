@echo off
setlocal
set "HERE=%~dp0"
where pwsh >nul 2>nul
if %errorlevel%==0 (
  start "" /min pwsh -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%HERE%tokenlens-host.ps1" -Restart
) else (
  start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%HERE%tokenlens-host.ps1" -Restart
)
endlocal
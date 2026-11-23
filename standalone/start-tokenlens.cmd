@echo off
setlocal
set "HERE=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js first.
  pause
  exit /b 1
)
start "TokenLens Host" /min node "%HERE%tokenlens-host.mjs"
endlocal

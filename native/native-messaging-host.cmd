@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

if exist "%SCRIPT_DIR%node.exe" (
  "%SCRIPT_DIR%node.exe" "%SCRIPT_DIR%native-messaging-host.cjs"
) else (
  node "%SCRIPT_DIR%native-messaging-host.cjs"
)

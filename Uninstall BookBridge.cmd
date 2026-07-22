@echo off
setlocal
title Uninstall BookBridge

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall-host.ps1"
set "BOOKBRIDGE_EXIT=%ERRORLEVEL%"

if not "%BOOKBRIDGE_EXIT%"=="0" (
  echo.
  echo BookBridge uninstall failed. Review the message above.
  pause
  exit /b %BOOKBRIDGE_EXIT%
)

echo.
echo BookBridge uninstall finished. Remove the extension from Chrome if needed.
pause

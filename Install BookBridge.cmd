@echo off
setlocal
title Install BookBridge

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-host.ps1"
set "BOOKBRIDGE_EXIT=%ERRORLEVEL%"

if not "%BOOKBRIDGE_EXIT%"=="0" (
  echo.
  echo BookBridge installation failed. Review the message above.
  pause
  exit /b %BOOKBRIDGE_EXIT%
)

echo.
echo BookBridge installation finished.
pause

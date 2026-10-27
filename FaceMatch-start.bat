@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is missing from PATH.
  echo Install Node.js, then double-click this file again.
  pause
  exit /b 1
)
node "%~dp0FaceMatch-backend.js"
if errorlevel 1 pause

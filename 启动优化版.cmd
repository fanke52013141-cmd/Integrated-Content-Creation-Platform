@echo off
chcp 65001 >nul
set "MOLIU_USER_DATA_DIR=%LOCALAPPDATA%\心流-optimized-0.2"
if not exist "%~dp0release\win-unpacked-new\心流.exe" (
  echo 请先在源码目录执行 npm run package:win
  pause
  exit /b 1
)
start "心流优化版" "%~dp0release\win-unpacked-new\心流.exe"

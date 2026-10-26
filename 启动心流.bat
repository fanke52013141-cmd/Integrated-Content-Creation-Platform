@echo off
chcp 65001 >nul
rem 心流 - 本地优先自媒体 AI 创作桌面应用启动器（源码模式）
cd /d "%~dp0"
if not exist "out\main\index.js" (
  echo [心流] 尚未构建，正在构建...
  call npm.cmd run build >nul 2>&1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b

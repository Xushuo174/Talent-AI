@echo off
setlocal
chcp 65001 >nul

set "N8N_DIR=%~dp0upstream\n8n"
set "STOP_MARKER=%~dp0.n8n-stop-requested"
del /q "%STOP_MARKER%" >nul 2>&1

if not exist "%N8N_DIR%\package.json" (
	echo [错误] 找不到 n8n 源码目录：
	echo %N8N_DIR%
	pause
	exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
	echo [错误] 找不到 node.exe，请先安装或配置 Node.js 24.x。
	pause
	exit /b 1
)

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
	echo [错误] 端口 5678 已被占用。
	echo 请先双击“关闭n8n.cmd”，然后再启动。
	pause
	exit /b 1
)

cd /d "%N8N_DIR%"
echo [n8n] 正在从 %N8N_DIR% 启动……
echo [n8n] 启动后访问 http://localhost:5678
echo [n8n] 请保持此窗口打开。
echo.

call "%N8N_DIR%\packages\cli\bin\n8n.cmd"
set "N8N_EXIT_CODE=%ERRORLEVEL%"

echo.
if exist "%STOP_MARKER%" (
	del /q "%STOP_MARKER%" >nul 2>&1
	echo [n8n] 已正常停止。
	set "N8N_EXIT_CODE=0"
) else if "%N8N_EXIT_CODE%"=="0" (
	echo [n8n] 已停止。
) else (
	echo [错误] n8n 已退出，错误码：%N8N_EXIT_CODE%
)
pause
exit /b %N8N_EXIT_CODE%

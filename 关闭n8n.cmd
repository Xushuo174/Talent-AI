@echo off
setlocal
chcp 65001 >nul
set "STOP_MARKER=%~dp0.n8n-stop-requested"

echo [n8n] 正在检查端口 5678……

set "N8N_PROCESS_ID="
for /f %%P in ('powershell.exe -NoProfile -Command "$listeners = @(Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue); if ($listeners.Count -gt 0) { Write-Output $listeners[0].OwningProcess }"') do set "N8N_PROCESS_ID=%%P"

if not defined N8N_PROCESS_ID (
	echo [n8n] 当前没有运行中的实例。
	set "STOP_EXIT_CODE=0"
	goto finish
)

powershell.exe -NoProfile -Command "$processInfo = Get-CimInstance Win32_Process -Filter 'ProcessId = %N8N_PROCESS_ID%' -ErrorAction SilentlyContinue; if ($processInfo -and $processInfo.Name -eq 'node.exe' -and $processInfo.CommandLine -match '(?i)packages[\\/]+cli[\\/]+bin[\\/]+n8n(?:\.cmd)?') { exit 0 }; exit 1"
if errorlevel 1 (
	echo [错误] PID %N8N_PROCESS_ID% 占用了 5678，但它不是 n8n，未终止。
	set "STOP_EXIT_CODE=1"
	goto finish
)

echo [n8n] 正在停止 PID %N8N_PROCESS_ID%……
> "%STOP_MARKER%" echo requested
taskkill.exe /PID %N8N_PROCESS_ID% /F >nul 2>&1
if errorlevel 1 (
	del /q "%STOP_MARKER%" >nul 2>&1
	echo [错误] 无法停止 PID %N8N_PROCESS_ID%。
	set "STOP_EXIT_CODE=1"
	goto finish
)

powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue) { exit 1 }; exit 0"
if errorlevel 1 (
	echo [错误] 端口 5678 仍被占用。
	set "STOP_EXIT_CODE=1"
) else (
	echo [n8n] 已停止，端口 5678 已释放。
	set "STOP_EXIT_CODE=0"
)

:finish
echo.
pause
exit /b %STOP_EXIT_CODE%

@echo off
setlocal

title SuperPoE2 Development Data Restore
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore.ps1"
set "RESTORE_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%RESTORE_EXIT_CODE%"=="0" (
  echo Restore failed. Review the message above, then try again.
) else (
  echo Restore completed successfully.
)

echo.
pause
exit /b %RESTORE_EXIT_CODE%

@echo off
REM Usage: scripts\restore.bat backups\dukasmart-2026-10-11_0200.sql
REM Replaces everything in the database with the contents of the backup file.
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: scripts\restore.bat backups\dukasmart-YYYY-MM-DD_HHMM.sql
  exit /b 1
)
if not exist "%~1" (
  echo File not found: %~1
  exit /b 1
)
echo This will REPLACE all data in the dukasmart database with %~1
set /p OK=Type YES to continue:
if /i not "%OK%"=="YES" exit /b 1

docker exec -i dukasmart-db sh -c "psql -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"" < "%~1"
if errorlevel 1 (
  echo Restore FAILED.
  exit /b 1
)
echo Restore complete.

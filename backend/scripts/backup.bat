@echo off
REM Saves a full copy of the database into backend\backups\dukasmart-YYYY-MM-DD_HHMM.sql
REM Keeps the newest 14 backups. Copy the backups folder to Google Drive or a flash disk regularly.
setlocal
cd /d "%~dp0.."
if not exist backups mkdir backups

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
set FILE=backups\dukasmart-%STAMP%.sql

docker exec dukasmart-db sh -c "pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" --clean --if-exists" > "%FILE%"
if errorlevel 1 (
  echo Backup FAILED. Is Docker Desktop running and the dukasmart-db container up?
  del "%FILE%" 2>nul
  exit /b 1
)

for %%A in ("%FILE%") do if %%~zA LSS 1000 (
  echo Backup file is suspiciously small, check it: %FILE%
  exit /b 1
)

powershell -NoProfile -Command "Get-ChildItem backups\dukasmart-*.sql | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item"
echo Backup saved to %FILE%

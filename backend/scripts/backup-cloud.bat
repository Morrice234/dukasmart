@echo off
REM Downloads a full copy of the cloud (Neon) database into backend\backups.
REM Put the Neon connection string in backend\.env as CLOUD_DATABASE_URL=...
REM Needs Docker Desktop running (it borrows the pg_dump tool from a Postgres image).
setlocal
cd /d "%~dp0.."
if not exist backups mkdir backups

for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if /i "%%a"=="CLOUD_DATABASE_URL" set "CLOUD_DATABASE_URL=%%b"
)
if "%CLOUD_DATABASE_URL%"=="" (
  echo Add CLOUD_DATABASE_URL=your Neon connection string to backend\.env first.
  exit /b 1
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
set FILE=backups\cloud-%STAMP%.sql

docker run --rm postgres:17-alpine pg_dump "%CLOUD_DATABASE_URL%" --clean --if-exists --no-owner --no-privileges > "%FILE%"
if errorlevel 1 (
  echo Backup FAILED.
  del "%FILE%" 2>nul
  exit /b 1
)
powershell -NoProfile -Command "Get-ChildItem backups\cloud-*.sql | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item"
echo Cloud backup saved to %FILE%

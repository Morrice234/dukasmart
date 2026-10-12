@echo off
REM Copies everything from the Docker database on this laptop into the cloud (Neon) database.
REM Usage: scripts\move-to-cloud.bat "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
REM Run it once, into an EMPTY cloud database, before pointing the app at the cloud.
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: scripts\move-to-cloud.bat "your Neon connection string"
  exit /b 1
)
if not exist backups mkdir backups

echo 1/2 Saving a copy of the laptop database...
docker exec dukasmart-db sh -c "pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" --no-owner --no-privileges" > backups\move-to-cloud.sql
if errorlevel 1 (
  echo Could not read the laptop database. Is Docker Desktop running?
  exit /b 1
)

echo 2/2 Loading it into the cloud database...
docker run --rm -i postgres:17-alpine psql "%~1" -v ON_ERROR_STOP=1 -q < backups\move-to-cloud.sql
if errorlevel 1 (
  echo Loading failed. The cloud database must be empty. Delete and recreate it in Neon, then try again.
  exit /b 1
)
echo Done. Your data is now in the cloud database.

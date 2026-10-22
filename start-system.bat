@echo off
chcp 65001 >nul
set "ComSpec=%SystemRoot%\System32\cmd.exe"
cd /d "%~dp0"

echo [1/4] Starting database (Docker: barbershop-db)...
set "NEWDB="
docker inspect -f "{{json .HostConfig.PortBindings}}" barbershop-db 2>nul | findstr "5440" >nul
if errorlevel 1 docker rm -f barbershop-db >nul 2>&1
docker container inspect barbershop-db >nul 2>&1
if errorlevel 1 (
  echo   ! No database container yet - creating barbershop-db on port 5440...
  docker run --name barbershop-db -e POSTGRES_PASSWORD=postgres -p 5440:5432 -d postgres:16
  set "NEWDB=1"
)
docker start barbershop-db >nul 2>&1
if errorlevel 1 (
  echo   ! Docker is not ready. Opening Docker Desktop, waiting 30s...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  timeout /t 30 /nobreak >nul
  docker start barbershop-db
)

if defined NEWDB (
  echo   Waiting for PostgreSQL to start...
  timeout /t 12 /nobreak >nul
  echo   Creating tables + sample data...
  pushd "%~dp0backend"
  node scripts/setup-db.js
  popd
)
echo [2/4] Starting backend (port 5050)...
start "Barbershop Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

echo [3/4] Starting frontend (port 3000)...
start "Barbershop Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo [4/4] Opening browser...
timeout /t 6 /nobreak >nul
start "" http://localhost:3000

echo.
echo Ready. Login: admin@trimco.local / 123456
echo Close the Backend and Frontend windows to stop the system.
timeout /t 10 >nul

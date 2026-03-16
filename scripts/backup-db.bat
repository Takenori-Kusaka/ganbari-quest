@echo off
REM scripts/backup-db.bat - SQLite DB backup with rotation (Docker対応)
REM Usage: backup-db.bat
REM Docker環境: C:\Docker\ganbari-quest のバインドマウント経由でバックアップ
REM Keeps last 10 backups

cd /d C:\Docker\ganbari-quest

set DB_PATH=data\ganbari-quest.db
set BACKUP_DIR=data\backups

if not exist "%DB_PATH%" (
    echo ERROR: Database not found at %DB_PATH%
    exit /b 1
)

if not exist "%BACKUP_DIR%" (
    mkdir "%BACKUP_DIR%"
)

REM Use Node.js backup script (WAL-safe, with rotation and optional GDrive hook)
node scripts\backup-db.cjs
if errorlevel 1 (
    echo Backup script failed, falling back to file copy...

    REM Generate timestamp
    for /f "tokens=1-6 delims=/:. " %%a in ("%date:~0,10% %time: =0%") do (
        set TIMESTAMP=%%a%%b%%c-%%d%%e%%f
    )
    set BACKUP_FILE=%BACKUP_DIR%\ganbari-quest-%TIMESTAMP%.db
    copy /Y "%DB_PATH%" "%BACKUP_FILE%"
)

echo === Backup complete ===

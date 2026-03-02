@echo off
REM scripts/backup-db.bat - SQLite DB backup with rotation
REM Usage: backup-db.bat [backup_dir]
REM Keeps last 10 backups

cd /d C:\Apps\ganbari-quest

set DB_PATH=data\ganbari-quest.db
set BACKUP_DIR=data\backups

if not exist "%DB_PATH%" (
    echo ERROR: Database not found at %DB_PATH%
    exit /b 1
)

if not exist "%BACKUP_DIR%" (
    mkdir "%BACKUP_DIR%"
)

REM Generate timestamp
for /f "tokens=1-6 delims=/:. " %%a in ("%date:~0,10% %time: =0%") do (
    set TIMESTAMP=%%a%%b%%c-%%d%%e%%f
)

set BACKUP_FILE=%BACKUP_DIR%\ganbari-quest-%TIMESTAMP%.db

REM Use SQLite .backup command for safe hot backup (WAL-safe)
node -e "const Database = require('better-sqlite3'); const db = new Database('%DB_PATH%'); db.backup('%BACKUP_FILE%').then(() => { console.log('Backup OK: %BACKUP_FILE%'); db.close(); }).catch(e => { console.error('Backup FAILED:', e); db.close(); process.exit(1); })"

if errorlevel 1 (
    echo Falling back to copy...
    copy /Y "%DB_PATH%" "%BACKUP_FILE%"
)

REM Show backup result
echo === Backup files ===
dir /b /o-d "%BACKUP_DIR%\*.db"

REM Rotate: keep only last 10
for /f "skip=10 delims=" %%f in ('dir /b /o-d "%BACKUP_DIR%\*.db" 2^>nul') do (
    echo Removing old backup: %%f
    del "%BACKUP_DIR%\%%f"
)

echo === Backup complete ===

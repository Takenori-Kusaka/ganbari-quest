#!/bin/bash
# setup-server.sh - NUCサーバー初期セットアップスクリプト
# Usage: ssh kusaka-server@192.168.68.79 < scripts/setup-server.sh

set -euo pipefail

APP_DIR="C:/Apps/ganbari-quest"
DATA_DIR="C:/Apps/ganbari-quest/data"

echo "=== がんばりクエスト サーバーセットアップ ==="

# ============================================================
# 1. ディレクトリ作成
# ============================================================
echo "[1/6] Creating directories..."
mkdir -p "${APP_DIR}" "${DATA_DIR}" "${DATA_DIR}/backups"

# ============================================================
# 2. Node.js 確認
# ============================================================
echo "[2/6] Checking Node.js..."
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed."
  echo "Please install Node.js LTS from https://nodejs.org/"
  exit 1
fi
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"

# ============================================================
# 3. .env 作成
# ============================================================
echo "[3/6] Creating .env file..."
if [ ! -f "${APP_DIR}/.env" ]; then
  cat > "${APP_DIR}/.env" << 'ENVEOF'
# Database
DATABASE_URL=./data/ganbari-quest.db

# Gemini API (optional - for character image generation)
GEMINI_API_KEY=your_gemini_api_key_here

# Server
HOST=0.0.0.0
PORT=3000
ORIGIN=http://192.168.68.79:3000
ENVEOF
  echo ".env created - please update GEMINI_API_KEY"
else
  echo ".env already exists - skipping"
fi

# ============================================================
# 4. ファイアウォール設定
# ============================================================
echo "[4/6] Configuring firewall..."
echo "Run the following in an elevated PowerShell:"
echo ""
echo '  New-NetFirewallRule -DisplayName "Ganbari Quest" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private'
echo ""
echo "This allows port 3000 access from LAN only (Private profile)."

# ============================================================
# 5. タスクスケジューラ設定
# ============================================================
echo "[5/6] Task Scheduler setup..."
STARTUP_SCRIPT="${APP_DIR}/start.bat"
cat > "${STARTUP_SCRIPT}" << 'BATEOF'
@echo off
cd /d C:\Apps\ganbari-quest
set NODE_ENV=production
set HOST=0.0.0.0
set PORT=3000
set ORIGIN=http://192.168.68.79:3000
node index.js >> C:\Apps\ganbari-quest\data\server.log 2>&1
BATEOF
echo "Created ${STARTUP_SCRIPT}"
echo ""
echo "To auto-start on login, run in elevated PowerShell:"
echo ""
echo '  $action = New-ScheduledTaskAction -Execute "C:\Apps\ganbari-quest\start.bat"'
echo '  $trigger = New-ScheduledTaskTrigger -AtLogOn'
echo '  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable'
echo '  Register-ScheduledTask -TaskName "GanbariQuest" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest'
echo ""

# ============================================================
# 6. 完了
# ============================================================
echo "[6/6] Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Deploy the app: bash scripts/deploy.sh"
echo "  2. Configure firewall (see step 4 above)"
echo "  3. Configure auto-start (see step 5 above)"
echo "  4. Access: http://192.168.68.79:3000"

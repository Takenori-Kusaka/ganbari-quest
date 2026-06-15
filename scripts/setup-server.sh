#!/bin/bash
# setup-server.sh - NUCサーバー初期セットアップスクリプト
# Usage: ssh "<NUC_SSH_USER>@<NUC_SSH_HOST>" "NUC_HOST=<NUC_SSH_HOST> bash -s" < scripts/setup-server.sh
#
# 接続情報は env 経由で渡す (#2987、公開 repo への実値直書き禁止):
#   NUC_HOST     NUC の LAN ホスト (IP or hostname)。ORIGIN / アクセス URL の生成に使用
#   NUC_APP_DIR  (任意) アプリ配置先。既定 C:/Apps/ganbari-quest。dry-run 検証用 override
# 実値の管理場所は .env.example の「NUC SSH 接続情報」セクションを参照。
# 未設定時は副作用 (mkdir 等) の前に即 fail する (silent fallback 禁止、ADR-0024)。

set -euo pipefail

NUC_HOST="${NUC_HOST:?NUC_HOST is required (LAN host/IP of the NUC, used for ORIGIN). Pass it on the ssh command line — see header Usage}"
APP_DIR="${NUC_APP_DIR:-C:/Apps/ganbari-quest}"
DATA_DIR="${APP_DIR}/data"

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
  cat > "${APP_DIR}/.env" << ENVEOF
# Database
DATABASE_URL=./data/ganbari-quest.db

# Gemini API (optional - for character image generation)
GEMINI_API_KEY=your_gemini_api_key_here

# Server
HOST=0.0.0.0
PORT=3000
ORIGIN=http://${NUC_HOST}:3000
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
cat > "${STARTUP_SCRIPT}" << BATEOF
@echo off
cd /d C:\Apps\ganbari-quest
set NODE_ENV=production
set HOST=0.0.0.0
set PORT=3000
set ORIGIN=http://${NUC_HOST}:3000
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
echo "  1. Deploy the app: NUC_SSH_USER=<user> NUC_SSH_HOST=${NUC_HOST} bash scripts/deploy.sh"
echo "  2. Configure firewall (see step 4 above)"
echo "  3. Configure auto-start (see step 5 above)"
echo "  4. Access: http://${NUC_HOST}:3000"

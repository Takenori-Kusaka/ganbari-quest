#!/bin/bash
# deploy.sh - NUCサーバーへのデプロイスクリプト
# Usage: bash scripts/deploy.sh

set -euo pipefail

# ============================================================
# Configuration
# ============================================================
REMOTE_USER="kusaka-server"
REMOTE_HOST="192.168.68.79"
REMOTE_DIR="C:/Apps/ganbari-quest"
REMOTE_DATA_DIR="C:/Apps/ganbari-quest/data"
SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ============================================================
# Pre-flight checks
# ============================================================
log "Pre-flight checks..."

# Check SSH connectivity
ssh -o ConnectTimeout=5 "${SSH_TARGET}" "echo ok" > /dev/null 2>&1 || error "SSH connection failed: ${SSH_TARGET}"
log "SSH connection OK"

# ============================================================
# Build locally
# ============================================================
log "Building application..."
npm run build || error "Build failed"
log "Build complete"

# ============================================================
# Backup remote DB
# ============================================================
log "Backing up remote database..."
ssh "${SSH_TARGET}" "powershell -Command \"
  \$backupDir = '${REMOTE_DATA_DIR}/backups'
  if (!(Test-Path \$backupDir)) { New-Item -ItemType Directory -Path \$backupDir -Force }
  \$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  \$dbPath = '${REMOTE_DATA_DIR}/ganbari-quest.db'
  if (Test-Path \$dbPath) {
    Copy-Item \$dbPath \"\$backupDir/ganbari-quest-\$timestamp.db\"
    Write-Host 'Backup created'
  } else {
    Write-Host 'No existing DB to backup'
  }
  # Keep only last 10 backups
  Get-ChildItem \$backupDir -Filter '*.db' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item -Force
\"" || warn "Backup step had issues (may be first deploy)"

# ============================================================
# Deploy files
# ============================================================
log "Deploying to ${SSH_TARGET}:${REMOTE_DIR}..."

# Create remote directories
ssh "${SSH_TARGET}" "powershell -Command \"
  @('${REMOTE_DIR}', '${REMOTE_DATA_DIR}') | ForEach-Object {
    if (!(Test-Path \$_)) { New-Item -ItemType Directory -Path \$_ -Force }
  }
\""

# Sync build output
scp -r build/* "${SSH_TARGET}:${REMOTE_DIR}/" || error "Failed to copy build files"
scp package.json package-lock.json "${SSH_TARGET}:${REMOTE_DIR}/" || error "Failed to copy package files"

# Copy drizzle config & schema (needed for drizzle-kit push)
ssh "${SSH_TARGET}" "powershell -Command \"
  @('${REMOTE_DIR}/src/lib/server/db') | ForEach-Object {
    if (!(Test-Path \$_)) { New-Item -ItemType Directory -Path \$_ -Force }
  }
\""
scp drizzle.config.ts "${SSH_TARGET}:${REMOTE_DIR}/" || warn "Failed to copy drizzle config"
scp src/lib/server/db/schema.ts "${SSH_TARGET}:${REMOTE_DIR}/src/lib/server/db/" || warn "Failed to copy schema"
scp tsconfig.json "${SSH_TARGET}:${REMOTE_DIR}/" || warn "Failed to copy tsconfig"

# Copy .env if it doesn't exist on remote
ssh "${SSH_TARGET}" "powershell -Command \"
  if (!(Test-Path '${REMOTE_DIR}/.env')) {
    Write-Host '.env not found on remote - please create it manually'
  } else {
    Write-Host '.env exists on remote'
  }
\""

# ============================================================
# Install production dependencies on remote
# ============================================================
log "Installing production dependencies..."
ssh "${SSH_TARGET}" "cd '${REMOTE_DIR}' && npm ci --omit=dev" || error "npm install failed"

# ============================================================
# Run DB migrations (push schema)
# ============================================================
log "Pushing database schema..."
ssh "${SSH_TARGET}" "cd '${REMOTE_DIR}' && npx drizzle-kit push" || warn "Schema push had issues"

# ============================================================
# Restart application
# ============================================================
log "Restarting application..."
ssh "${SSH_TARGET}" "powershell -Command \"
  # Stop existing process
  \$proc = Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object { \$_.CommandLine -like '*ganbari-quest*' }
  if (\$proc) {
    \$proc | Stop-Process -Force
    Write-Host 'Stopped existing process'
    Start-Sleep -Seconds 2
  }

  # Start new process
  \$env:NODE_ENV = 'production'
  \$env:HOST = '0.0.0.0'
  \$env:PORT = '3000'
  \$env:ORIGIN = 'http://192.168.68.79:3000'
  Start-Process -FilePath 'node' -ArgumentList '${REMOTE_DIR}/index.js' -WorkingDirectory '${REMOTE_DIR}' -WindowStyle Hidden
  Write-Host 'Application started'
\""

# ============================================================
# Health check
# ============================================================
log "Waiting for server to start..."
sleep 3

if curl -sf "http://${REMOTE_HOST}:3000" > /dev/null 2>&1; then
  log "Health check passed!"
  log "Application is running at http://${REMOTE_HOST}:3000"
else
  warn "Health check failed - server may still be starting"
  warn "Check manually: http://${REMOTE_HOST}:3000"
fi

log "Deploy complete!"

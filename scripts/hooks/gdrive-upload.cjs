// scripts/hooks/gdrive-upload.cjs - Google Drive backup upload hook
// Called by backup-db.cjs via BACKUP_POST_HOOK
// Usage: node scripts/hooks/gdrive-upload.cjs <backup-file-path>
//
// Required env vars (in .env):
//   GDRIVE_CLIENT_ID      - Google OAuth2 Client ID
//   GDRIVE_CLIENT_SECRET  - Google OAuth2 Client Secret
//   GDRIVE_REFRESH_TOKEN  - Google OAuth2 Refresh Token
//   GDRIVE_FOLDER_ID      - Target folder ID in Google Drive
//
// Initial setup (one-time, requires browser):
//   node scripts/gdrive-auth-setup.cjs <CLIENT_ID> <CLIENT_SECRET>

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Load .env if exists
const envPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const MAX_GDRIVE_BACKUPS = 30;

async function main() {
  const backupPath = process.argv[2];
  if (!backupPath || !fs.existsSync(backupPath)) {
    console.error('[GDrive] ERROR: Backup file path required as argument');
    process.exit(1);
  }

  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const folderId = process.env.GDRIVE_FOLDER_ID;

  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    console.error('[GDrive] ERROR: GDRIVE_* env vars not fully configured');
    if (!refreshToken) console.error('  Run: node scripts/gdrive-auth-setup.cjs');
    process.exit(1);
  }

  const backupFilename = path.basename(backupPath);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Upload
  const res = await drive.files.create({
    requestBody: {
      name: backupFilename,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(backupPath),
    },
    fields: 'id, name, size',
  });
  console.log(`[GDrive] Uploaded: ${res.data.name} (id: ${res.data.id})`);

  // Rotate old backups
  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'ganbari-quest-' and trashed = false`,
    orderBy: 'name desc',
    fields: 'files(id, name)',
    pageSize: 100,
  });

  const gdriveFiles = listRes.data.files || [];
  if (gdriveFiles.length > MAX_GDRIVE_BACKUPS) {
    for (const old of gdriveFiles.slice(MAX_GDRIVE_BACKUPS)) {
      await drive.files.delete({ fileId: old.id });
      console.log(`[GDrive] Removed old: ${old.name}`);
    }
  }
  console.log(`[GDrive] Total: ${Math.min(gdriveFiles.length, MAX_GDRIVE_BACKUPS)} backups`);
}

main().catch(err => {
  console.error('[GDrive] Fatal error:', err.message);
  process.exit(1);
});

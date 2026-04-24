// scripts/backup-to-gdrive.cjs
// WAL-safe SQLite backup + Google Drive upload (OAuth2 Refresh Token)
// Usage: node scripts/backup-to-gdrive.cjs
//
// Required env vars in .env:
//   GDRIVE_CLIENT_ID      - Google OAuth2 Client ID
//   GDRIVE_CLIENT_SECRET  - Google OAuth2 Client Secret
//   GDRIVE_REFRESH_TOKEN  - Google OAuth2 Refresh Token (one-time setup via gdrive-auth-setup.cjs)
//   GDRIVE_FOLDER_ID      - Target folder ID in Google Drive
//
// Initial setup (one-time, requires browser):
//   node scripts/gdrive-auth-setup.cjs <CLIENT_ID> <CLIENT_SECRET>

const Database = require('better-sqlite3');
const { google } = require('googleapis');
const path = require('node:path');
const fs = require('node:fs');

// Load .env if exists
const envPath = path.join(__dirname, '..', '.env');
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

const DB_PATH = process.env.DATABASE_URL
	? path.resolve(process.env.DATABASE_URL)
	: path.join(__dirname, '..', 'data', 'ganbari-quest.db');
const BACKUP_DIR = process.env.BACKUP_DIR
	? path.resolve(process.env.BACKUP_DIR)
	: path.join(path.dirname(DB_PATH), 'backups');
const MAX_LOCAL_BACKUPS = 7;
const MAX_GDRIVE_BACKUPS = 7;

async function main() {
	console.log('=== Ganbari Quest Backup ===');
	console.log(`Time: ${new Date().toISOString()}`);

	// 1. Local backup
	if (!fs.existsSync(DB_PATH)) {
		console.error('ERROR: Database not found at', DB_PATH);
		process.exit(1);
	}
	if (!fs.existsSync(BACKUP_DIR)) {
		fs.mkdirSync(BACKUP_DIR, { recursive: true });
	}

	const now = new Date();
	const ts = now
		.toISOString()
		.replace(/[-:T.Z]/g, '')
		.slice(0, 14);
	const backupFilename = `ganbari-quest-${ts}.db`;
	const backupPath = path.join(BACKUP_DIR, backupFilename);

	const db = new Database(DB_PATH);
	try {
		await db.backup(backupPath);
		console.log(`[Local] Backup OK: ${backupFilename}`);
	} catch (err) {
		console.error('[Local] Backup FAILED:', err);
		db.close();
		process.exit(1);
	}
	db.close();

	// Verify backup integrity
	try {
		const bdb = new Database(backupPath, { readonly: true });
		const count = bdb.prepare('SELECT COUNT(*) as cnt FROM children').get();
		bdb.close();
		console.log(`[Local] Integrity check: OK (${count.cnt} children)`);
	} catch (err) {
		console.error('[Local] Integrity check FAILED:', err);
		process.exit(1);
	}

	// Rotate local backups
	const localFiles = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith('ganbari-quest-') && f.endsWith('.db'))
		.sort()
		.reverse();
	if (localFiles.length > MAX_LOCAL_BACKUPS) {
		for (const old of localFiles.slice(MAX_LOCAL_BACKUPS)) {
			fs.unlinkSync(path.join(BACKUP_DIR, old));
			console.log(`[Local] Removed old: ${old}`);
		}
	}
	console.log(`[Local] Total backups: ${Math.min(localFiles.length, MAX_LOCAL_BACKUPS)}`);

	// 2. Google Drive upload (OAuth2 with refresh token)
	const clientId = process.env.GDRIVE_CLIENT_ID;
	const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
	const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
	const folderId = process.env.GDRIVE_FOLDER_ID;

	if (!clientId || !clientSecret || !refreshToken || !folderId) {
		console.warn('[GDrive] Skipped: GDRIVE_* env vars not fully configured');
		if (!refreshToken) console.warn('  Run: node scripts/gdrive-auth-setup.cjs');
		console.log('=== Backup complete (local only) ===');
		return;
	}

	try {
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

		// Rotate old backups on Google Drive
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
		console.log(`[GDrive] Total backups: ${Math.min(gdriveFiles.length, MAX_GDRIVE_BACKUPS)}`);
	} catch (err) {
		console.error('[GDrive] Upload FAILED:', err.message);
	}

	console.log('=== Backup complete ===');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});

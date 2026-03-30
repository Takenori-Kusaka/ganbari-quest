// scripts/migrate-file-paths.cjs
// NUC ローカル用: ファイルパスをテナントプレフィックス付きに移行
//
// 旧パス: static/uploads/avatars/avatar-{childId}-{timestamp}.{ext}
//         static/generated/avatar-{childId}-{hash}.{ext}
// 新パス: static/tenants/{tenantId}/avatars/{childId}/{uuid}.{ext}
//         static/tenants/{tenantId}/generated/{childId}/{hash}.{ext}
//
// Usage:
//   node scripts/migrate-file-paths.cjs [db-path] [--dry-run]
//   docker compose exec app node scripts/migrate-file-paths.cjs /app/data/ganbari-quest.db

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// --- Config ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dbPath = args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'data', 'ganbari-quest.db');
const TENANT_ID = 'local'; // NUC は常に local テナント
const STATIC_DIR = path.join(path.dirname(dbPath), '..', 'static');

console.log('=== File Path Migration (NUC Local) ===');
console.log(`Database: ${dbPath}`);
console.log(`Static dir: ${STATIC_DIR}`);
console.log(`Tenant ID: ${TENANT_ID}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
console.log('');

if (!fs.existsSync(dbPath)) {
	console.error(`Error: Database not found at ${dbPath}`);
	process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// --- Phase 1: アバター画像の移行 ---
console.log('--- Phase 1: Avatar files ---');

const children = db.prepare('SELECT id, nickname, avatar_url FROM children WHERE avatar_url IS NOT NULL').all();
console.log(`Children with avatars: ${children.length}`);

const avatarUpdates = [];

for (const child of children) {
	const oldUrl = child.avatar_url; // e.g. /uploads/avatars/avatar-1-1772336481513.jpg
	if (!oldUrl) continue;

	// Already migrated?
	if (oldUrl.startsWith(`/tenants/${TENANT_ID}/`)) {
		console.log(`  [SKIP] child ${child.id} (${child.nickname}): already migrated → ${oldUrl}`);
		continue;
	}

	const oldKey = oldUrl.startsWith('/') ? oldUrl.slice(1) : oldUrl;
	const oldFilePath = path.join(STATIC_DIR, oldKey);
	const ext = path.extname(oldUrl).slice(1) || 'jpg';
	const uuid = crypto.randomUUID();
	const newKey = `tenants/${TENANT_ID}/avatars/${child.id}/${uuid}.${ext}`;
	const newUrl = `/${newKey}`;
	const newFilePath = path.join(STATIC_DIR, newKey);

	if (!fs.existsSync(oldFilePath)) {
		console.log(`  [WARN] child ${child.id} (${child.nickname}): old file not found at ${oldFilePath}`);
		// DB は更新しない（ファイルが存在しないなら新パスに更新しても意味がない）
		continue;
	}

	avatarUpdates.push({ childId: child.id, nickname: child.nickname, oldUrl, newUrl, oldFilePath, newFilePath });
	console.log(`  [MOVE] child ${child.id} (${child.nickname}): ${oldUrl} → ${newUrl}`);
}

// --- Phase 2: 生成画像の移行 ---
console.log('');
console.log('--- Phase 2: Generated image files ---');

const generatedDir = path.join(STATIC_DIR, 'generated');
const generatedFiles = [];

if (fs.existsSync(generatedDir)) {
	const files = fs.readdirSync(generatedDir).filter((f) => !fs.statSync(path.join(generatedDir, f)).isDirectory());
	console.log(`Generated files found: ${files.length}`);

	for (const file of files) {
		// Format: avatar-{childId}-{hash}.{ext}
		const match = file.match(/^avatar-(\d+)-(.+)\.(\w+)$/);
		if (!match) {
			console.log(`  [SKIP] ${file}: pattern not recognized`);
			continue;
		}
		const childId = parseInt(match[1], 10);
		const hash = match[2];
		const ext = match[3];
		const oldFilePath = path.join(generatedDir, file);
		const newKey = `tenants/${TENANT_ID}/generated/${childId}/${hash}.${ext}`;
		const newFilePath = path.join(STATIC_DIR, newKey);

		generatedFiles.push({ childId, oldFile: file, oldFilePath, newKey, newFilePath });
		console.log(`  [MOVE] generated/${file} → ${newKey}`);
	}
} else {
	console.log('Generated directory not found, skipping.');
}

// --- Phase 3: DB の character_images テーブル更新 ---
console.log('');
console.log('--- Phase 3: character_images DB update ---');

let charImageUpdates = [];
try {
	const charImages = db.prepare("SELECT id, child_id, image_url FROM character_images WHERE image_url IS NOT NULL AND image_url NOT LIKE '/tenants/%'").all();
	console.log(`Character images to migrate: ${charImages.length}`);

	for (const img of charImages) {
		const oldUrl = img.image_url;
		const oldKey = oldUrl.startsWith('/') ? oldUrl.slice(1) : oldUrl;
		// e.g. generated/avatar-1-hash.svg → tenants/local/generated/1/hash.svg
		const match = oldKey.match(/^generated\/avatar-(\d+)-(.+)\.(\w+)$/);
		if (match) {
			const childId = parseInt(match[1], 10);
			const hash = match[2];
			const ext = match[3];
			const newUrl = `/tenants/${TENANT_ID}/generated/${childId}/${hash}.${ext}`;
			charImageUpdates.push({ id: img.id, childId, oldUrl, newUrl });
			console.log(`  [UPDATE] id=${img.id} child=${childId}: ${oldUrl} → ${newUrl}`);
		} else {
			console.log(`  [SKIP] id=${img.id}: pattern not recognized: ${oldUrl}`);
		}
	}
} catch (e) {
	console.log(`  character_images table not found or empty: ${e.message}`);
}

// --- Execute ---
console.log('');
if (DRY_RUN) {
	console.log('=== DRY RUN - no changes made ===');
	console.log(`Avatars to move: ${avatarUpdates.length}`);
	console.log(`Generated files to move: ${generatedFiles.length}`);
	console.log(`Character image DB rows to update: ${charImageUpdates.length}`);
	db.close();
	process.exit(0);
}

console.log('=== Executing migration ===');

// 1. ファイルコピー（アバター）
let filesCopied = 0;
for (const item of avatarUpdates) {
	const dir = path.dirname(item.newFilePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.copyFileSync(item.oldFilePath, item.newFilePath);
	filesCopied++;
	console.log(`  Copied: ${item.oldUrl} → ${item.newUrl}`);
}

// 2. ファイルコピー（生成画像）
for (const item of generatedFiles) {
	const dir = path.dirname(item.newFilePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.copyFileSync(item.oldFilePath, item.newFilePath);
	filesCopied++;
	console.log(`  Copied: ${item.oldFile} → ${item.newKey}`);
}

// 3. DB更新（トランザクション）
const updateAvatar = db.prepare('UPDATE children SET avatar_url = ? WHERE id = ?');
const updateCharImage = db.prepare('UPDATE character_images SET image_url = ? WHERE id = ?');

const migrate = db.transaction(() => {
	for (const item of avatarUpdates) {
		updateAvatar.run(item.newUrl, item.childId);
		console.log(`  DB updated: children.id=${item.childId} avatar_url → ${item.newUrl}`);
	}
	for (const item of charImageUpdates) {
		updateCharImage.run(item.newUrl, item.id);
		console.log(`  DB updated: character_images.id=${item.id} image_url → ${item.newUrl}`);
	}
});
migrate();

// 4. 旧ファイルを削除
let filesDeleted = 0;
for (const item of avatarUpdates) {
	if (fs.existsSync(item.oldFilePath)) {
		fs.unlinkSync(item.oldFilePath);
		filesDeleted++;
	}
}
for (const item of generatedFiles) {
	if (fs.existsSync(item.oldFilePath)) {
		fs.unlinkSync(item.oldFilePath);
		filesDeleted++;
	}
}

// 5. 空になった旧ディレクトリを削除
const oldUploadDir = path.join(STATIC_DIR, 'uploads', 'avatars');
if (fs.existsSync(oldUploadDir) && fs.readdirSync(oldUploadDir).length === 0) {
	fs.rmdirSync(oldUploadDir);
	console.log('  Removed empty directory: uploads/avatars/');
	const uploadsDir = path.join(STATIC_DIR, 'uploads');
	if (fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length === 0) {
		fs.rmdirSync(uploadsDir);
		console.log('  Removed empty directory: uploads/');
	}
}
if (fs.existsSync(generatedDir) && fs.readdirSync(generatedDir).length === 0) {
	fs.rmdirSync(generatedDir);
	console.log('  Removed empty directory: generated/');
}

db.close();

console.log('');
console.log('=== Migration complete ===');
console.log(`Files copied: ${filesCopied}`);
console.log(`Files deleted: ${filesDeleted}`);
console.log(`Avatar DB rows updated: ${avatarUpdates.length}`);
console.log(`Character image DB rows updated: ${charImageUpdates.length}`);

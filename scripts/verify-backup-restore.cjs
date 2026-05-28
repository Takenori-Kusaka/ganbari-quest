// scripts/verify-backup-restore.cjs — backup restore + integrity 検証 (#2519)
//
// Usage:
//   node scripts/verify-backup-restore.cjs
//
// 最新 backup file を一時 file に restore (copy) し、以下を assert する:
//   1. PRAGMA integrity_check  = 'ok'        (B-tree / page 構造の健全性)
//   2. PRAGMA foreign_key_check = 空          (FK orphan が無い)
//   3. 主要 table の row count  > 0           (空の backup = 復旧不能を検出)
//
// すべて PASS で exit 0、1 つでも fail で exit 1。
//
// ## 設計背景 (GitLab 2017 postmortem 教訓 — #2519 / research §7)
//
// 既存 `backup-db.cjs` は backup 後に「table 数 > 0」しか確認しない。これは
// 「backup file が存在する」ことの確認に過ぎず、「その backup から実際に restore
// できる / restore した DB が壊れていない / 中身が空でない」ことを保証しない。
// GitLab 2017 の data loss incident は **backup が存在したのに restore できず**
// 6 時間分の data を失った典型例。NUC は単一 SQLite で冗長性ゼロのため、backup の
// restore 可能性検証が最後の砦になる (ADR-0010 Bucket A: data 保全 = 親離脱直結)。
//
// ## 検証対象 table
//
// data 消失が即 = 親離脱に直結する core data を持つ table:
//   - children            (子供 = アカウントの中核)
//   - child_activities    (各 child の活動 = Issue #2510 の orphan 爆心地)
//   - activity_logs       (活動記録 = 貯めたポイントの履歴)
//   - point_ledger        (ポイント残高明細)
// いずれも「空 backup」は復旧不能 (= data 喪失) を意味するため row > 0 を要求する。
// ただし backup が「真に空の新規 DB」である可能性 (初回起動直後 backup) を許容する
// ため、ALLOW_EMPTY=1 で空 DB を PASS にできる (CI smoke / 初回検証用)。

const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// .env 読込 (backup-db.cjs と同パターン)
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
// 明示 backup file 指定 (test / 単発検証用)。未指定なら BACKUP_DIR の最新を使う。
const EXPLICIT_BACKUP = process.env.VERIFY_BACKUP_FILE
	? path.resolve(process.env.VERIFY_BACKUP_FILE)
	: '';

// row > 0 を要求または監視する core table
const MONITORED_TABLES = ['children', 'child_activities', 'activity_logs', 'point_ledger'];

// 失敗時の Discord alert webhook (任意)。`src/lib/server/discord-alert.ts` と同 env を参照。
// .cjs (cron) からは SvelteKit module を import できないため、ここで最小限の fetch を行う。
const DISCORD_WEBHOOK =
	process.env.DISCORD_ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_INCIDENT || '';

/**
 * 検証失敗を Discord に通知 (#2519 AC2)。webhook 未設定なら no-op。
 * cron 経路で fail-loud にするための最小実装。
 */
async function notifyFailure(backupPath, failures) {
	if (!DISCORD_WEBHOOK) return;
	const embed = {
		title: '🚨 [CRITICAL] backup restore 検証 失敗',
		description: 'NUC backup が安全に restore できません。data 保全リスク。',
		color: 10038562,
		fields: [
			{ name: 'Backup', value: `\`${backupPath}\``, inline: false },
			{ name: 'Failures', value: `\`\`\`${failures.join('\n').slice(0, 800)}\`\`\`` },
			{
				name: '対応',
				value: 'docs/runbooks/activities-data-recovery.md / backup cron を確認',
			},
		],
		timestamp: new Date().toISOString(),
		footer: { text: 'がんばりクエスト backup verification' },
	};
	try {
		await fetch(DISCORD_WEBHOOK, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: '@everyone', embeds: [embed] }),
		});
		console.log('[verify] Discord alert sent');
	} catch (err) {
		console.error('[verify] Discord alert failed (non-fatal):', err.message);
	}
}

/** BACKUP_DIR から最新の backup file path を返す (無ければ null)。 */
function findLatestBackup() {
	if (!fs.existsSync(BACKUP_DIR)) return null;
	const files = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith('ganbari-quest-') && f.endsWith('.db'))
		.sort()
		.reverse();
	return files.length > 0 ? path.join(BACKUP_DIR, files[0]) : null;
}

/** table が存在するか (PRAGMA / sqlite_master)。 */
function tableExists(db, name) {
	return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

/**
 * 復元済 backup に対し integrity_check / foreign_key_check / row count を検査。
 * @returns { ok: boolean, failures: string[] }
 */
function verifyRestoredDb(restoredPath) {
	const failures = [];
	const db = new Database(restoredPath, { readonly: true });
	try {
		// 1. integrity_check
		const integrity = db.pragma('integrity_check');
		const integrityOk =
			Array.isArray(integrity) && integrity.length === 1 && integrity[0].integrity_check === 'ok';
		if (integrityOk) {
			console.log('[verify] PRAGMA integrity_check: ok');
		} else {
			failures.push(`integrity_check failed: ${JSON.stringify(integrity)}`);
		}

		// 2. foreign_key_check (空配列 = orphan なし)
		const fkViolations = db.pragma('foreign_key_check');
		if (Array.isArray(fkViolations) && fkViolations.length === 0) {
			console.log('[verify] PRAGMA foreign_key_check: clean (0 violations)');
		} else {
			failures.push(
				`foreign_key_check found ${fkViolations.length} violation(s): ${JSON.stringify(fkViolations.slice(0, 5))}`,
			);
		}

		// 3. 主要 table row count > 0
		const counts = [];
		let totalRows = 0;
		const cMap = {};
		for (const table of MONITORED_TABLES) {
			if (!tableExists(db, table)) {
				failures.push(`required table missing: ${table}`);
				cMap[table] = 0;
				continue;
			}
			const c = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
			counts.push(`${table}=${c}`);
			cMap[table] = c;
			totalRows += c;
		}
		console.log(`[verify] row counts: ${counts.join(' ')}`);

		// ALLOW_EMPTY=1 のとき「全 table 0 行」は PASS (初回起動直後 backup を許容)。
		const allowEmpty = process.env.ALLOW_EMPTY === '1';
		if (totalRows === 0 && allowEmpty) {
			console.log('[verify] all monitored tables empty but ALLOW_EMPTY=1 → treated as PASS');
		} else {
			// AC1: children > 0 なのに child_activities = 0 は fail
			// AC2: children > 0 + child_activities > 0 であれば、activity_logs / point_ledger が 0 (day-0) でも PASS
			if (cMap.children === 0) {
				failures.push('required table empty (data loss risk): children');
			} else if (cMap.child_activities === 0) {
				failures.push('data loss risk: children > 0 but child_activities is empty');
			}
		}
	} finally {
		db.close();
	}
	return { ok: failures.length === 0, failures };
}

async function main() {
	console.log('=== Ganbari Quest Backup Restore Verification (#2519) ===');
	console.log(`Time: ${new Date().toISOString()}`);

	const backupPath = EXPLICIT_BACKUP || findLatestBackup();
	if (!backupPath) {
		console.error(`[verify] FAILED: no backup found in ${BACKUP_DIR}`);
		console.error('[verify] backup が 1 件も無い = 復旧手段ゼロ。backup cron を確認してください。');
		await notifyFailure(BACKUP_DIR, ['no backup found — backup cron が動いていない可能性']);
		process.exit(1);
	}
	if (!fs.existsSync(backupPath)) {
		console.error(`[verify] FAILED: backup file not found: ${backupPath}`);
		await notifyFailure(backupPath, ['backup file not found']);
		process.exit(1);
	}
	console.log(`Backup: ${backupPath}`);

	// 一時 file に restore (本 backup を read-only で直接開かず copy して検証する。
	// WAL / lock 干渉を避け、検証中に元 backup を変更しないため)。
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-verify-'));
	const restoredPath = path.join(tmpDir, 'restored.db');
	let result;
	try {
		fs.copyFileSync(backupPath, restoredPath);
		console.log(`[verify] restored to temp: ${restoredPath}`);
		result = verifyRestoredDb(restoredPath);
	} finally {
		// 一時 file は必ず削除
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch (err) {
			console.warn('[verify] temp cleanup failed (non-fatal):', err.message);
		}
	}

	if (result.ok) {
		console.log('[verify] PASS — backup is restorable and intact');
		console.log('=== Verification complete ===');
		process.exit(0);
	}
	console.error('[verify] FAILED — backup is NOT safely restorable:');
	for (const f of result.failures) {
		console.error(`  ✗ ${f}`);
	}
	await notifyFailure(backupPath, result.failures);
	process.exit(1);
}

module.exports = { verifyRestoredDb };

if (require.main === module) {
	main().catch((err) => {
		console.error('[verify] Fatal error:', err);
		process.exit(1);
	});
}

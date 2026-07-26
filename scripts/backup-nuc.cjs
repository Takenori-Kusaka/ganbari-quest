// scripts/backup-nuc.cjs - NUC 日次バックアップの入口 (#3950)
//
// docker-compose の backup サービス (crond) から 1 日 1 回呼ばれる。DATA_SOURCE を見て
// 実データの backend に対応した経路へ振り分ける。
//
//   DATA_SOURCE=pglite  -> アプリの /api/cron/pglite-backup を叩く (本番 NUC の現行構成)
//   それ以外            -> 従来の SQLite 経路 (backup-db.cjs + verify-backup-restore.cjs)
//
// ── なぜ HTTP 越しなのか ────────────────────────────────────────────────
// PGlite は dataDir を単一プロセスで占有するため、backup コンテナから直接 open できない。
// 整合したスナップショットを採れるのは DB を掴んでいるアプリプロセスだけなので、そこへ起動を
// 依頼する形になる (詳細: src/lib/server/db/pglite/backup.ts 冒頭)。
//
// ── なぜ振り分けが要るのか (#3950 の事故) ────────────────────────────────
// 2026-07-12 の PGlite 移行後も backup サービスは旧 SQLite を複製し続け、しかもその SQLite に
// 残った FK violation で毎日 fail していた。「毎日動いているように見えて実データは無保護」を
// 二度と作らないため、backend の判定をこの 1 箇所に集約し、対象外の経路は明示的に skip する。
//
// Environment variables:
//   DATA_SOURCE          - 実データの backend (pglite / sqlite ...)
//   APP_URL              - アプリのベース URL (default: http://app:3000)
//   CRON_SECRET          - /api/cron/* の認証シークレット (pglite 経路で必須)
//   DISCORD_ALERT_WEBHOOK_URL - 失敗通知先 (任意)

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// .env 読み込み (backup-db.cjs と同じ最小実装)
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

const DATA_SOURCE = process.env.DATA_SOURCE || 'sqlite';
const APP_URL = process.env.APP_URL || 'http://app:3000';
const CRON_SECRET = process.env.CRON_SECRET || process.env.OPS_SECRET_KEY || '';
const DISCORD_WEBHOOK =
	process.env.DISCORD_ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_INCIDENT || '';

/**
 * バックアップ失敗を Discord に通知する。webhook 未設定なら no-op。
 * fail が沈黙しないための最小実装 (verify-backup-restore.cjs と同じ形)。
 *
 * @param {string} detail
 */
async function notifyFailure(detail) {
	if (!DISCORD_WEBHOOK) {
		console.error('[backup-nuc] Discord webhook 未設定のため通知を送れません');
		return;
	}
	const embed = {
		title: '🚨 [CRITICAL] NUC バックアップ 失敗',
		description: `DATA_SOURCE=${DATA_SOURCE} のバックアップに失敗しました。data 保全リスク。`,
		color: 10038562,
		fields: [
			{ name: 'Detail', value: `\`\`\`${detail.slice(0, 800)}\`\`\`` },
			{ name: '対応', value: 'docs/runbooks/pglite-restore-drill.md / backup cron を確認' },
		],
		timestamp: new Date().toISOString(),
		footer: { text: 'がんばりクエスト backup (#3950)' },
	};
	try {
		await fetch(DISCORD_WEBHOOK, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: '@everyone', embeds: [embed] }),
		});
		console.log('[backup-nuc] Discord alert sent');
	} catch (err) {
		console.error(
			'[backup-nuc] Discord alert failed (non-fatal):',
			err instanceof Error ? err.message : String(err),
		);
	}
}

/** PGlite 経路: アプリの cron エンドポイントを叩き、結果を判定する。 */
async function runPgliteBackup() {
	if (!CRON_SECRET) {
		throw new Error('CRON_SECRET が未設定です (/api/cron/pglite-backup の認証に必要)');
	}
	const url = `${APP_URL.replace(/\/$/, '')}/api/cron/pglite-backup`;
	console.log(`[backup-nuc] POST ${url}`);
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'x-cron-secret': CRON_SECRET, 'Content-Type': 'application/json' },
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
	}
	/** @type {{ ok?: boolean, filename?: string, bytes?: number, durationMs?: number, generationsKept?: number, verification?: unknown, error?: string }} */
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		throw new Error(`レスポンスが JSON ではありません: ${text.slice(0, 500)}`);
	}
	// HTTP 200 でも ok:false なら失敗として扱う (silent success を作らない)。
	if (!body.ok) {
		throw new Error(body.error || 'エンドポイントが ok:false を返しました');
	}
	console.log(
		`[backup-nuc] OK: ${body.filename} (${body.bytes} bytes, ${body.durationMs}ms, ` +
			`保持 ${body.generationsKept} 世代)`,
	);
	console.log(`[backup-nuc] verification: ${JSON.stringify(body.verification)}`);
}

/** SQLite 経路: 従来どおり backup-db.cjs + verify-backup-restore.cjs を直列実行する。 */
function runSqliteBackup() {
	console.log('[backup-nuc] DATA_SOURCE が pglite ではないため SQLite 経路で実行します');
	for (const script of ['backup-db.cjs', 'verify-backup-restore.cjs']) {
		execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
	}
}

async function main() {
	console.log('=== Ganbari Quest NUC Backup ===');
	console.log(`Time: ${new Date().toISOString()}`);
	console.log(`DATA_SOURCE: ${DATA_SOURCE}`);

	if (DATA_SOURCE === 'pglite') {
		await runPgliteBackup();
	} else {
		runSqliteBackup();
	}
}

main().catch(async (err) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error('[backup-nuc] FAILED:', message);
	await notifyFailure(message);
	process.exit(1);
});

// scripts/backup-nuc.cjs - NUC 日次バックアップの入口 (#3950)
//
// docker-compose の backup サービス (crond) から 1 日 1 回呼ばれる。DATA_SOURCE を見て
// 実データの backend に対応した経路へ振り分ける。
//
//   pglite  -> アプリの /api/cron/pglite-backup を叩く (本番 NUC の現行構成)
//   それ以外 -> 従来の SQLite 経路 (backup-db.cjs + verify-backup-restore.cjs)
//
// ── backend の決め方 (#3967) ────────────────────────────────────────────
// 判定の一次情報は **env ではなく /api/health の dataSource** (= アプリが実際に使っている
// backend)。env の DATA_SOURCE は照合にのみ使い、食い違ったら実行前に落とす。
// 旧実装 `process.env.DATA_SOURCE || 'sqlite'` は未設定・typo・配布漏れのいずれでも黙って
// SQLite 経路に落ちるため、間違った backend を「成功」と報告しうる形だった。
// 判定ロジック本体は scripts/lib/backup-backend.cjs (unit test 対象)。
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
//   DATA_SOURCE          - 実データの backend (pglite / sqlite ...)。/api/health との照合用
//   APP_URL              - アプリのベース URL (default: http://app:3000)
//   CRON_SECRET          - /api/cron/* の認証シークレット (pglite 経路で必須)
//   DISCORD_ALERT_WEBHOOK_URL - 失敗通知先 (任意)

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { resolveBackupBackend } = require('./lib/backup-backend.cjs');

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

// #3967: 既定値を置かない。未設定は「未設定」のまま resolveBackupBackend に渡し、
// /api/health を真実の源として解決させる (暗黙の sqlite フォールバックを作らない)。
const ENV_DATA_SOURCE = process.env.DATA_SOURCE;
const APP_URL = process.env.APP_URL || 'http://app:3000';
const CRON_SECRET = process.env.CRON_SECRET || process.env.OPS_SECRET_KEY || '';
const DISCORD_WEBHOOK =
	process.env.DISCORD_ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_INCIDENT || '';

/**
 * 状態ファイルから連続失敗回数を読む (#4129 AC4)。読めなければ null。
 *
 * 「今日も失敗した」ではなく「**N 晩続けて失敗している**」を出すために使う。
 * 毎晩同じ alert が流れるだけだと埋もれる (2026-07-31 の実害は 18 日間気づかれなかった)。
 *
 * @returns {number | null}
 */
function readConsecutiveFailures() {
	const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
	try {
		const raw = fs.readFileSync(path.resolve(backupDir, 'backup-status-pglite.json'), 'utf-8');
		const parsed = JSON.parse(raw);
		return typeof parsed.consecutiveFailures === 'number' ? parsed.consecutiveFailures : null;
	} catch {
		// 状態ファイルが無い / 壊れている場合は回数を出さないだけ。元の失敗は握り潰さない。
		return null;
	}
}

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
	// #4129 AC4: 連続失敗回数を alert 本文に載せる。1 通ずつ見ると同じに見える alert が、
	// 回数を持つことで「昨日から続いている」と読めるようになる。
	const streak = readConsecutiveFailures();
	const streakNote =
		streak && streak > 1
			? `**${streak} 晩連続で失敗しています。** 単発の失敗ではありません。`
			: null;
	const embed = {
		title:
			streak && streak > 1
				? `🚨 [CRITICAL] NUC バックアップ ${streak} 晩連続失敗`
				: '🚨 [CRITICAL] NUC バックアップ 失敗',
		description: streakNote
			? `NUC のバックアップに失敗しました。data 保全リスク。
${streakNote}`
			: `NUC のバックアップに失敗しました。data 保全リスク。`,
		color: 10038562,
		fields: [
			{ name: 'Detail', value: `\`\`\`${detail.slice(0, 800)}\`\`\`` },
			...(streak !== null ? [{ name: '連続失敗', value: `${streak} 回`, inline: true }] : []),
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
	console.log('[backup-nuc] backend が pglite ではないため SQLite 経路で実行します');
	for (const script of ['backup-db.cjs', 'verify-backup-restore.cjs']) {
		execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
	}
}

/**
 * `/api/health` を叩いて JSON を返す。到達できなければ null。
 *
 * ここで例外にせず null を返すのは、「取得できなかった」ことの扱いを
 * resolveBackupBackend 側に一本化するため (env フォールバックの有無を 1 箇所で決める)。
 */
async function fetchHealth() {
	const url = `${APP_URL.replace(/\/$/, '')}/api/health`;
	try {
		const res = await fetch(url);
		// 503 (DB 到達不可) でも body に dataSource は載る。backend の同定には使えるので
		// status では弾かず、dataSource の有無だけを resolveBackupBackend に判定させる。
		return { url, body: await res.json() };
	} catch (err) {
		console.error(
			`[backup-nuc] ${url} に到達できません:`,
			err instanceof Error ? err.message : String(err),
		);
		return { url, body: null };
	}
}

async function main() {
	console.log('=== Ganbari Quest NUC Backup ===');
	console.log(`Time: ${new Date().toISOString()}`);
	console.log(`env DATA_SOURCE: ${ENV_DATA_SOURCE ?? '(未設定)'}`);

	const health = await fetchHealth();
	// 判定できない / env と食い違う場合はここで throw され、main().catch が alert する。
	// **backend が確定するまでバックアップを実行しない** (間違った backend を成功と報告しない)。
	const resolved = resolveBackupBackend({
		envDataSource: ENV_DATA_SOURCE,
		health: health.body,
		healthUrl: health.url,
	});
	console.log(`[backup-nuc] backend=${resolved.backend} (${resolved.source}) — ${resolved.detail}`);

	if (resolved.backend === 'pglite') {
		await runPgliteBackup();
	} else {
		runSqliteBackup();
	}
}

main().catch(async (err) => {
	const message = err instanceof Error ? err.message : String(err);
	const streak = readConsecutiveFailures();
	console.error('[backup-nuc] FAILED:', message);
	if (streak !== null && streak > 1) {
		console.error(`[backup-nuc] ${streak} 晩連続で失敗しています (単発ではありません、#4129 AC4)`);
	}
	await notifyFailure(message);
	process.exit(1);
});

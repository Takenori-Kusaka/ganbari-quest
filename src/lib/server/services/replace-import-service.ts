// src/lib/server/services/replace-import-service.ts
// #3326: 置換インポート (replace import) の原子化 (import-then-swap / recover-safe)。
//
// 背景: 本番 tenant t-82c17558 で「全削除 → 逐次投入」の非原子インポートが途中 hang し家族データが
// 半分消失した。clear 先行 → import 途中失敗 = 旧データ永久喪失、が構造的に発生していた (事故の故障モード)。
//
// 本サービスは clear + import を **「途中失敗時に旧データを必ず復元可能」な原子境界**で実行する。
// backend ごとに手段が異なる (ADR-0063 / backup-import-redesign §3.3 / dsql-data-model §9.1):
//   - SQLite (local): 単一接続で `BEGIN IMMEDIATE` → 失敗で `ROLLBACK`。clear も import も同一 tx に乗る。
//   - pg 系 (cloud DSQL / NUC PGlite、#4720): 単一 txn は不可 (DSQL は 1 write txn 3,000 行上限 §P8 +
//     repo 内 runInTransaction のネスト禁止 #3535)。よって **backup-before-clear (補償トランザクション)**:
//     clear 前に旧データ (data.json + 静的ファイル) を full backup ZIP として storage
//     (`tenants/<tenantId>/recovery/`) に永続化してから clear + import を試行し、失敗時は ZIP から
//     clear + 復元する。プロセス死 (Lambda timeout 等) でも永続化済 ZIP から手動復旧できる。
//     成功時は ZIP を削除する。
//   - demo: 書込が stub のため原子性は無意味。素通しする。
//
// #3438 Phase 2B: DynamoDB backend (同型の補償トランザクション経路) は cutover 完了により撤去。
// #4720 以前は `currentBackend()` が demo 以外を全部 'sqlite' と判定し、pg でも better-sqlite3 の
// `db` に BEGIN/ROLLBACK するだけ (実 DB は clear 済のまま) だった = 本番でだけ壊れる class (#4680)。
//
// 重要: `$lib/server/db/client` (SQLite) を module top で static import しない。cloud Lambda 環境で
// SQLite startup 副作用を避けるため、SQLite 戦略内でのみ dynamic import する (data-service.ts と同方針)。

import type { ExportData } from '$lib/domain/export-format';
import { IMPORT_LABELS } from '$lib/domain/labels';
import { resolveDbBackend } from '$lib/server/db/backend';
import { logger } from '$lib/server/logger';
import { recoveryPrefix } from '$lib/server/storage-keys';
import { clearAllFamilyData } from './data-service';
import { type ImportResult, importFamilyData } from './import-service';

type ReplaceStrategy = 'sqlite' | 'pg' | 'passthrough';

/** 置換インポートの原子境界戦略。backend 判定は db/backend.ts の resolveDbBackend に揃える (#4720)。 */
export function resolveReplaceStrategy(dataSource?: string): ReplaceStrategy {
	switch (resolveDbBackend(dataSource)) {
		case 'sqlite':
			return 'sqlite';
		case 'dsql':
		case 'pglite':
			return 'pg';
		default:
			return 'passthrough';
	}
}

/**
 * import 途中で hard error が発生し、原子境界が中止 (rollback / restore) されたことを表す。
 * 呼び出し側はこれを捕捉し「旧データは保全された」旨をユーザーに伝える。
 */
export class AtomicReplaceError extends Error {
	constructor(readonly result: ImportResult) {
		// #4752: 顧客に出す文言は labels SSOT。取込失敗の内訳 (result.errors) は route が log にだけ残す。
		super(IMPORT_LABELS.errorReplaceAbortedPreserved);
		this.name = 'AtomicReplaceError';
	}
}

/**
 * 置換前の snapshot 取得 / 永続化に失敗したため、旧データを失うリスクを冒さず置換を開始しなかったことを表す。
 */
export class ReplaceSnapshotError extends Error {
	constructor(cause: unknown) {
		super(IMPORT_LABELS.errorReplaceSnapshotFailed, { cause });
		this.name = 'ReplaceSnapshotError';
	}
}

/**
 * pg 系で import 失敗後の復元 (二次故障) まで失敗し、旧データが storage の snapshot にしか残っていない
 * ことを表す。呼び出し側は「保全されています」と言わず、**半端な状態である旨 + 復旧手段** を顧客に返す
 * (#4752 PO 回答 2026-09-03 条件 2)。
 *
 * - `recoveryKey`: storage 上の復旧用 ZIP の key (運営向け。log / Discord alert にのみ載せる)
 * - `recoveryCode`: 顧客が運営に伝える短い参照 (ZIP 名の時刻部分)。tenant id / storage key は顧客に出さない
 * - `message`: 顧客向け文言 (labels SSOT、復旧コード入り)。route は 409 `IMPORT_RESTORE_FAILED` で返す
 *   (500 にすると client が文言を捨てて「時間をおいて再度お試しください」になる、ADR-0062 §2)
 * - `cause`: 復元失敗の原因例外 (原因の連鎖を log に残す)
 */
export class ReplaceRestoreFailedError extends Error {
	readonly recoveryCode: string;
	constructor(
		readonly recoveryKey: string,
		/** 復元 (補償) 自体を止めた例外。`cause` に載せる (二次故障の原因はこちら)。 */
		restoreCause: unknown,
		/** 復元の引き金になった元の取込失敗。原因の連鎖を保つため別 field で保持する。 */
		readonly originalError?: unknown,
	) {
		const recoveryCode = recoveryCodeFromKey(recoveryKey);
		super(IMPORT_LABELS.errorReplaceRestoreFailedWithCode(recoveryCode), {
			cause: restoreCause,
		});
		this.name = 'ReplaceRestoreFailedError';
		this.recoveryCode = recoveryCode;
	}
}

/** 復旧用 ZIP key `.../replace-import-<stamp>.zip` から顧客に伝える復旧コード (`<stamp>`) を取り出す。 */
export function recoveryCodeFromKey(recoveryKey: string): string {
	const m = /replace-import-([^/]+)\.zip$/.exec(recoveryKey);
	return m?.[1] ?? recoveryKey.split('/').pop() ?? recoveryKey;
}

/**
 * clear + import を「途中失敗時に旧データを必ず復元可能」な原子境界で実行する。
 * backend ごとに手段が異なる (本ファイル冒頭コメント参照)。
 */
export async function runAtomicReplace<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
	switch (resolveReplaceStrategy()) {
		case 'sqlite':
			return runSqliteTransactional(work);
		case 'pg':
			return runPgSnapshotProtected(tenantId, work);
		default:
			return work();
	}
}

/**
 * 置換インポートの公開エントリ。clear → import を原子境界で実行し、hard error があれば
 * 原子境界を中止して旧データを復元する (success-on-partial-failure ban)。
 */
export async function replaceImportAtomic(
	data: ExportData,
	tenantId: string,
	staticFiles?: Record<string, Uint8Array>,
): Promise<ImportResult> {
	return runAtomicReplace(tenantId, async () => {
		await clearAllFamilyData(tenantId);
		const result = await importFamilyData(data, tenantId, staticFiles);
		// hard error (例外を伴う取込失敗) が 1 件でもあれば、半端な置換結果を確定させず原子境界を中止する。
		// (childRef 不在等の skip は errors でなく *Skipped に積まれるため、中止対象にしない)
		if (result.errors.length > 0) {
			throw new AtomicReplaceError(result);
		}
		return result;
	});
}

// ── SQLite (local): 単一接続の BEGIN/ROLLBACK ラッパ ──────────────────────────
async function runSqliteTransactional<T>(work: () => Promise<T>): Promise<T> {
	const [{ db }, { sql }] = await Promise.all([
		import('$lib/server/db/client'),
		import('drizzle-orm'),
	]);
	// BEGIN IMMEDIATE: import 中は write lock を握り他 writer を直列化する (busy_timeout=5000)。
	// clear / import 内部の db.transaction() は better-sqlite3 が SAVEPOINT にネストするため整合する。
	db.run(sql.raw('BEGIN IMMEDIATE'));
	try {
		const result = await work();
		db.run(sql.raw('COMMIT'));
		return result;
	} catch (err) {
		try {
			db.run(sql.raw('ROLLBACK'));
		} catch (rollbackErr) {
			logger.error('[replace-import] ROLLBACK 失敗', { error: String(rollbackErr) });
		}
		throw err;
	}
}

// ── pg 系 (DSQL / PGlite): backup-before-clear (補償トランザクション) ─────────────
async function runPgSnapshotProtected<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
	// 1. clear 前に旧データ (data.json + 静的ファイル) を full backup ZIP として storage に永続化する。
	//    取得 / 永続化自体が失敗したら、旧データを失うリスクを冒さず安全側に倒して中止する。
	//    プロセス死 (timeout 等) で in-memory snapshot が失われても、永続化済 ZIP から復旧できる。
	const snapshot = await takeRecoverySnapshot(tenantId);

	// 2. clear + import を試行。失敗したら snapshot から復元する。
	try {
		const result = await work();
		// 成功: 復旧用 ZIP は不要 (best-effort 削除。残っても次回 backup には含めない: backup-archive が
		// recovery/ を除外する)。
		await deleteRecoveryFile(snapshot.key);
		return result;
	} catch (err) {
		logger.error('[replace-import] import 失敗、snapshot から復元を試行', {
			error: String(err),
			context: { tenantId, recoveryKey: snapshot.key },
		});
		const restored = await restoreFromSnapshot(tenantId, snapshot, err);
		// #4752: 二次故障の cause は「復元を止めた例外」。旧実装は元の取込失敗を cause にしていたため、
		// 復元がなぜ止まったのかが throw された error からは辿れなかった (log にしか残らなかった)。
		if (!restored.ok) throw new ReplaceRestoreFailedError(snapshot.key, restored.error, err);
		throw err;
	}
}

interface RecoverySnapshot {
	key: string;
	data: ExportData;
	staticFiles: Record<string, Uint8Array>;
}

/** 旧データ (data + 静的ファイル) を ZIP 化して storage に永続化し、復元用に保持する。 */
async function takeRecoverySnapshot(tenantId: string): Promise<RecoverySnapshot> {
	try {
		const [{ exportFamilyDataForZip }, { buildFullBackupZip, parseBackupZip }, { saveFile }] =
			await Promise.all([
				import('./export-service'),
				import('./backup-archive'),
				import('$lib/server/storage'),
			]);
		const { exportData, dataJson } = await exportFamilyDataForZip({ tenantId });
		const zip = await buildFullBackupZip(tenantId, exportData, true, dataJson);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const key = `${recoveryPrefix(tenantId)}replace-import-${stamp}.zip`;
		await saveFile(key, Buffer.from(zip), 'application/zip');
		// 復元に使う静的ファイルは ZIP から取り出しておく (storage 上の原本は clear で消える)。
		const parsed = await parseBackupZip(zip);
		if (!parsed.ok) throw new Error(`snapshot zip parse failed: ${parsed.error}`);
		logger.info('[replace-import] 復旧用 snapshot を退避', { context: { tenantId, key } });
		return { key, data: exportData, staticFiles: parsed.value.staticFiles };
	} catch (snapErr) {
		logger.error('[replace-import] snapshot 取得 / 永続化失敗、置換を中止', {
			error: String(snapErr),
			context: { tenantId },
		});
		throw new ReplaceSnapshotError(snapErr);
	}
}

async function deleteRecoveryFile(key: string): Promise<void> {
	try {
		const { deleteFile } = await import('$lib/server/storage');
		await deleteFile(key);
	} catch (err) {
		logger.warn('[replace-import] 復旧用 snapshot の削除に失敗 (残置しても backup には含めない)', {
			error: String(err),
		});
	}
}

/**
 * import 失敗時に旧データを復元する。復元自体の失敗 (二次故障) は永続化済 snapshot による
 * 手動復旧の退路を残し、オペレータへ即時 alert する。
 */
async function restoreFromSnapshot(
	tenantId: string,
	snapshot: RecoverySnapshot,
	originalErr: unknown,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
	try {
		await clearAllFamilyData(tenantId); // 部分投入された新データを除去
		const restored = await importFamilyData(snapshot.data, tenantId, snapshot.staticFiles); // 旧データを復元
		if (restored.errors.length > 0) {
			throw new Error(`restore errors: ${restored.errors.join(' / ')}`);
		}
		logger.info('[replace-import] snapshot から復元成功', {
			context: { tenantId, recoveryKey: snapshot.key },
		});
		await deleteRecoveryFile(snapshot.key);
		return { ok: true };
	} catch (restoreErr) {
		logger.error('[replace-import] 復元失敗。永続化済 snapshot で手動復旧が必要', {
			error: String(restoreErr),
			context: {
				tenantId,
				recoveryKey: snapshot.key,
				recoveryCode: recoveryCodeFromKey(snapshot.key),
				originalError: String(originalErr),
			},
		});
		// #3520: 二次故障 (復元自体の失敗)。ログだけでは誰も気づかず家庭のデータが黙って失われうるため、
		// この経路に限定してオペレータへ即時 Discord alert を送る (alert 失敗で本来の再送出を阻害しない)。
		const { sendDiscordAlert } = await import('$lib/server/discord-alert');
		await sendDiscordAlert({
			level: 'critical',
			message: '置換インポートの復元に失敗しました。永続化済 snapshot で手動復旧が必要です',
			errorSummary: 'replace-import restore failed (secondary failure)',
			details: `recoveryKey=${snapshot.key} restore=${String(restoreErr)} original=${String(originalErr)}`,
		}).catch((alertErr) =>
			logger.error('[replace-import] 二次故障 alert 送信失敗', { error: String(alertErr) }),
		);
		return { ok: false, error: restoreErr };
	}
}

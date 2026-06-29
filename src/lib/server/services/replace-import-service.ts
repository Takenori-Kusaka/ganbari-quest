// src/lib/server/services/replace-import-service.ts
// #3326: 置換インポート (replace import) の原子化 (import-then-swap / recover-safe)。
//
// 背景: 本番 tenant t-82c17558 で「全削除 → 逐次投入」の非原子インポートが途中 hang し家族データが
// 半分消失した。clear 先行 → import 途中失敗 = 旧データ永久喪失、が構造的に発生していた (事故の故障モード)。
//
// 本サービスは clear + import を **「途中失敗時に旧データを必ず復元可能」な原子境界**で実行する。
// backend ごとに手段が異なる (ADR-0063 / backup-import-redesign §3.3):
//   - SQLite (NUC): 単一接続で `BEGIN IMMEDIATE` → 失敗で `ROLLBACK`。clear も import も同一 tx に乗る。
//   - DynamoDB (本番): tenant の上に staging を切る namespace 間接層が無く (`keys.ts` `T#<tenantId>#…`)、
//     TransactWriteItems も 100 item 上限のため単一 tx 不可。clear 前に旧データを snapshot 退避し、
//     import 失敗時に snapshot から復元する backup-before-clear (補償トランザクション) で根治する。
//   - demo: 書込が stub のため原子性は無意味。素通しする。
//
// 重要: `$lib/server/db/client` (SQLite) を module top で static import しない。DynamoDB Lambda 環境で
// SQLite startup 副作用を避けるため、SQLite 戦略内でのみ dynamic import する (data-service.ts と同方針)。

import type { ExportData } from '$lib/domain/export-format';
import { logger } from '$lib/server/logger';
import { clearAllFamilyData } from './data-service';
import { type ImportResult, importFamilyData } from './import-service';

type Backend = 'sqlite' | 'dynamodb' | 'passthrough';

function currentBackend(): Backend {
	const src = process.env.DATA_SOURCE ?? 'sqlite';
	if (src === 'dynamodb') return 'dynamodb';
	if (src === 'demo') return 'passthrough';
	return 'sqlite';
}

/**
 * import 途中で hard error が発生し、原子境界が中止 (rollback / restore) されたことを表す。
 * 呼び出し側はこれを捕捉し「旧データは保全された」旨をユーザーに伝える。
 */
export class AtomicReplaceError extends Error {
	constructor(readonly result: ImportResult) {
		super('インポートにエラーが発生したため置換を中止しました（既存データは保全されています）');
		this.name = 'AtomicReplaceError';
	}
}

/**
 * clear + import を「途中失敗時に旧データを必ず復元可能」な原子境界で実行する。
 * backend ごとに手段が異なる (本ファイル冒頭コメント参照)。
 */
export async function runAtomicReplace<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
	switch (currentBackend()) {
		case 'sqlite':
			return runSqliteTransactional(work);
		case 'dynamodb':
			return runDynamoSnapshotProtected(tenantId, work);
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

// ── SQLite (NUC): 単一接続の BEGIN/ROLLBACK ラッパ ──────────────────────────
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

// ── DynamoDB (本番): backup-before-clear (補償トランザクション) ─────────────
async function runDynamoSnapshotProtected<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
	const { exportFamilyData } = await import('./export-service');

	// 1. clear 前に旧データのスナップショットを取得する (補償用)。
	//    取得自体が失敗したら、旧データを失うリスクを冒さず安全側に倒して中止する。
	let snapshot: ExportData;
	try {
		snapshot = await exportFamilyData({ tenantId });
	} catch (snapErr) {
		logger.error('[replace-import] スナップショット取得失敗、置換を中止', {
			error: String(snapErr),
		});
		throw new Error('置換前のバックアップ取得に失敗したため、安全のため中止しました');
	}

	// 2. clear + import を試行。失敗したらスナップショットから復元する。
	try {
		return await work();
	} catch (err) {
		logger.error('[replace-import] import 失敗、スナップショットから復元を試行', {
			error: String(err),
		});
		await restoreFromSnapshot(tenantId, snapshot, err);
		throw err;
	}
}

/**
 * import 失敗時に旧データを復元する。二次故障 (復元自体の失敗) に備え、まずスナップショットを
 * storage に永続化してオペレータ手動復旧の退路を残す。
 */
async function restoreFromSnapshot(
	tenantId: string,
	snapshot: ExportData,
	originalErr: unknown,
): Promise<void> {
	await persistSnapshotForRecovery(tenantId, snapshot).catch((persistErr) =>
		logger.error('[replace-import] スナップショット永続化失敗', { error: String(persistErr) }),
	);
	try {
		await clearAllFamilyData(tenantId); // 部分投入された新データを除去
		await importFamilyData(snapshot, tenantId); // 旧データを復元
		logger.info('[replace-import] スナップショットから復元成功', { context: { tenantId } });
	} catch (restoreErr) {
		logger.error('[replace-import] 復元失敗。永続化済スナップショットで手動復旧が必要', {
			error: String(restoreErr),
			context: { tenantId, originalError: String(originalErr) },
		});
	}
}

/** 補償復元の退路として、clear 前スナップショットを storage に JSON で退避する。 */
async function persistSnapshotForRecovery(tenantId: string, snapshot: ExportData): Promise<void> {
	const { saveFile } = await import('$lib/server/storage');
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const key = `tenants/${tenantId}/recovery/replace-import-${stamp}.json`;
	await saveFile(key, Buffer.from(JSON.stringify(snapshot), 'utf8'), 'application/json');
	logger.info('[replace-import] 復旧用スナップショットを退避', { context: { tenantId, key } });
}

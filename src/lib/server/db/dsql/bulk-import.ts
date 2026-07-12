// src/lib/server/db/dsql/bulk-import.ts
// EPIC #3424 / M4-E item 9 (#3436) / 設計 SSOT: m3-physical-model.md §6.4 / §P5 / m2-logical-model.md I-4
//
// 一括 import / 復元の chunk saga プリミティブ。DSQL の 1 書込 txn ハード上限
// (**3,000 行 AND 10 MiB、両方独立に効く**。PoC 検証4 実測: 3,001 行 = `54000 row limit` /
// 11.3MiB = `54000 transaction size limit`) を超える backup-archive 復元 (#3376) を
// 安全に適用するための 2 部品:
//
//   1. **chunkByLimits**: 行数 AND byte size の両上限で greedy 分割 (大 blob 行は 3,000 行
//      未満でも 10MiB に到達しうるため byte も計測して切る、§6.4)。
//   2. **runChunkedImport**: chunk ごとに 1 txn で適用する saga。
//      - **exactly-once の核**: 進捗マーカ (settings KVS の行) を **chunk の書込と同一 txn で
//        INSERT** する。chunk とマーカは原子的に共倒れ / 共成立するため、再実行時は
//        マーカ有無だけで「適用済み chunk の skip」が正確に判定でき、**書込 SQL 自体に
//        冪等性を要求しない** (部分失敗の冪等再適用 = #3436 AC2)。
//      - **buildChunkStatements は同期関数** (SQL 組立のみ)。txn work 内の await は
//        tx.execute 直呼びに限定され、fetch / 通知 / 別 db を txn に持ち込む余地が
//        型レベルで存在しない (fitness#7 / §8 と同思想の構造強制)。
//      - saga 状態は `import-saga:<batchId>:state` (in-progress → committed)。全 chunk 成功後に
//        マーカを掃除して committed 化する (§6.4「import 中フラグ → 全 chunk 成功後 commit」)。
//
// マーカの置き場 = settings 表 (family スコープ KVS、PK (family_id, key)):
//   - マーカは「一時的な運用オーケストレーション状態」であり domain entity ではないため、
//     専用表の新設 (PK 凍結 manifest / §11.2 同期を伴う schema 変更) はせず KVS を使う。
//     domain データの KVS 間借り (inquiry #3612 で排除した class) とは責務が異なる。
//   - マーカ行数 = chunk 数 (≤ ceil(総行数/2,500))。家族スケールでは高々数十行で、
//     掃除 DELETE (key LIKE 単文) が txn 上限に達することはない。
//
// **再実行の前提 (呼び出し側契約)**: 同一 batchId の再実行は「同一入力 + 同一 chunking」で
// 行うこと (chunk はマーカの index で同定されるため、入力が変わると skip 判定が狂う)。
// chunkByLimits は入力順序に対し決定的。

import { sql } from 'drizzle-orm';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { SqlExecutor } from './sql-executor';

/** DSQL の 1 書込 txn ハード上限 (調整不可、PoC 検証4 実測)。 */
export const DSQL_TXN_MAX_ROWS = 3000;
export const DSQL_TXN_MAX_BYTES = 10 * 1024 * 1024;

/**
 * 既定 chunk 予算。ハード上限に対しマージンを取る:
 * - 行数: マーカ 1 行 + 派生行 (呼び出し側 applyChunk が付随行を書く余地) を見込み 2,500
 * - byte: プロトコル / パラメータ overhead を見込み 8 MiB
 */
export const DEFAULT_CHUNK_MAX_ROWS = 2500;
export const DEFAULT_CHUNK_MAX_BYTES = 8 * 1024 * 1024;

export interface ChunkLimits {
	maxRows?: number;
	maxBytes?: number;
}

/**
 * 行数 AND byte size の両上限で greedy にチャンク分割する (§6.4)。
 * 単一行が maxBytes を超える場合は分割不能 (DSQL でも必ず fail する) ため即座に throw する。
 */
export function chunkByLimits<T>(
	rows: readonly T[],
	measureBytes: (row: T) => number,
	limits?: ChunkLimits,
): T[][] {
	const maxRows = limits?.maxRows ?? DEFAULT_CHUNK_MAX_ROWS;
	const maxBytes = limits?.maxBytes ?? DEFAULT_CHUNK_MAX_BYTES;
	if (maxRows < 1 || maxRows > DSQL_TXN_MAX_ROWS) {
		throw new Error(`chunkByLimits: maxRows は 1..${DSQL_TXN_MAX_ROWS} (got ${maxRows})`);
	}
	if (maxBytes < 1 || maxBytes > DSQL_TXN_MAX_BYTES) {
		throw new Error(`chunkByLimits: maxBytes は 1..${DSQL_TXN_MAX_BYTES} (got ${maxBytes})`);
	}
	const chunks: T[][] = [];
	let current: T[] = [];
	let currentBytes = 0;
	for (const [i, row] of rows.entries()) {
		const bytes = measureBytes(row);
		if (bytes > maxBytes) {
			throw new Error(
				`chunkByLimits: 行 ${i} が単独で byte 上限を超過 (${bytes} > ${maxBytes})。` +
					'この行は DSQL txn 上限 (10MiB) でも必ず失敗するため、行自体の分割か縮約が必要',
			);
		}
		if (current.length >= maxRows || currentBytes + bytes > maxBytes) {
			if (current.length > 0) chunks.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(row);
		currentBytes += bytes;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

const SAGA_KEY_PREFIX = 'import-saga:';

const stateKey = (batchId: string) => `${SAGA_KEY_PREFIX}${batchId}:state`;
const chunkKey = (batchId: string, index: number) => `${SAGA_KEY_PREFIX}${batchId}:chunk:${index}`;

export interface ChunkedImportResult {
	appliedChunks: number;
	skippedChunks: number;
}

export interface ChunkedImportOptions<T, TTx extends SqlExecutor> {
	db: SqlExecutor;
	runner: TransactionRunner<TTx>;
	tenantId: string;
	/** import バッチ ID (再実行時は同一 ID + 同一入力で呼ぶこと)。 */
	batchId: string;
	chunks: readonly (readonly T[])[];
	/**
	 * 1 chunk の書込 SQL 文を**同期**で組み立てる (実行は本 saga が tx.execute で行う)。
	 * **同期関数であることが契約**: txn work 内の await を tx.execute 直呼びに限定し、
	 * fetch / 通知 / 別 db アクセスを txn に持ち込む余地を型レベルで封じる (fitness#7 /
	 * dsql-data-model.md §8 と同思想)。**同一 tx に進捗マーカが同梱される**ため冪等性は不要。
	 * 文数 + 1 (マーカ) が DSQL txn 上限内に収まるよう chunkByLimits の予算で分割された
	 * chunk を渡すこと。
	 */
	buildChunkStatements: (chunk: readonly T[], chunkIndex: number) => ReturnType<typeof sql>[];
}

/**
 * chunk saga を実行する (§6.4)。部分失敗時はそのまま reject し、同一 batchId での再実行で
 * 未適用 chunk のみが適用される (適用済み chunk はマーカで skip、行の二重挿入なし)。
 */
export async function runChunkedImport<T, TTx extends SqlExecutor>(
	options: ChunkedImportOptions<T, TTx>,
): Promise<ChunkedImportResult> {
	const { db, runner, tenantId, batchId, chunks, buildChunkStatements } = options;

	// saga begin: 「import 中」フラグ (再実行時は in-progress のまま上書き)
	await db.execute(sql`
		INSERT INTO settings (family_id, key, value)
		VALUES (${tenantId}, ${stateKey(batchId)}, 'in-progress')
		ON CONFLICT (family_id, key) DO UPDATE SET value = 'in-progress', updated_at = now()
	`);

	// 適用済み chunk マーカの回収 (再実行時の skip 判定)
	const markerRows = await db.execute(sql`
		SELECT key FROM settings
		WHERE family_id = ${tenantId} AND key LIKE ${`${SAGA_KEY_PREFIX}${batchId}:chunk:%`}
	`);
	const done = new Set((markerRows.rows as { key: string }[]).map((r) => r.key));

	let applied = 0;
	let skipped = 0;
	for (const [i, chunk] of chunks.entries()) {
		if (done.has(chunkKey(batchId, i))) {
			skipped++;
			continue;
		}
		const statements = buildChunkStatements(chunk, i);
		await runner.runInTransaction(async (tx) => {
			for (const statement of statements) {
				await tx.execute(statement);
			}
			// exactly-once の核: マーカを chunk と同一 txn で書く (共倒れ / 共成立)
			await tx.execute(sql`
				INSERT INTO settings (family_id, key, value)
				VALUES (${tenantId}, ${chunkKey(batchId, i)}, ${String(chunk.length)})
			`);
		});
		applied++;
	}

	// saga commit: マーカ掃除 + committed 化 (同一 txn。マーカ行数 = chunk 数で txn 上限に遠い)
	await runner.runInTransaction(async (tx) => {
		await tx.execute(sql`
			DELETE FROM settings
			WHERE family_id = ${tenantId} AND key LIKE ${`${SAGA_KEY_PREFIX}${batchId}:chunk:%`}
		`);
		await tx.execute(sql`
			UPDATE settings SET value = 'committed', updated_at = now()
			WHERE family_id = ${tenantId} AND key = ${stateKey(batchId)}
		`);
	});

	return { appliedChunks: applied, skippedChunks: skipped };
}

/** saga 状態の読取 (テスト / 監視用)。 */
export async function getImportSagaState(
	db: SqlExecutor,
	tenantId: string,
	batchId: string,
): Promise<string | undefined> {
	const result = await db.execute(sql`
		SELECT value FROM settings
		WHERE family_id = ${tenantId} AND key = ${stateKey(batchId)}
	`);
	return (result.rows[0] as { value: string } | undefined)?.value;
}

// src/lib/server/db/dsql/migration/async-index-poll.ts
// EPIC #3424 / M4-B① カスタム migration runner (ASYNC index build 完了 poll)
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 責務 3 (F3)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 3 (#3427)
//
// ⚠️ 実測で観測した hard 制約 (検証 3):
//   `CREATE INDEX ASYNC` は**受理即 OK を返すが index は background build 完了まで uniqueness を
//   強制しない**。build 完了前に重複を INSERT すると sys.jobs の INDEX_BUILD job が
//   `status=failed`（`found duplicate key(s) …`）となり **index が有効化されない = 以後も
//   dedup がすり抜ける**。
//   → 正しい手順: clean state に ASYNC UNIQUE index を張り、
//     sys.jobs (job_type='INDEX_BUILD', object_name='public.<idx>') の status='completed' を
//     **poll 確認してから書込を開放**する。本モジュールはこの poll を実装する。

/** poll 用の最小 SQL 実行面 (raw 文字列を実行し rows を返す)。runner から注入される。 */
export interface RawSqlExecutor {
	execute(sql: string): Promise<{ rows: unknown[] }>;
}

export interface AsyncIndexPollOptions {
	/** poll 全体の timeout。既定 60_000ms。超過で throw (責務 4: timeout ハンドリング)。 */
	timeoutMs?: number;
	/** poll 間隔。既定 500ms。 */
	intervalMs?: number;
	/** テスト注入用の sleep。既定 setTimeout。 */
	sleep?: (ms: number) => Promise<void>;
	/** テスト注入用の時刻源。既定 Date.now。 */
	now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 500;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** sys.jobs の 1 行から status を取り出す (大小無視で正規化)。 */
function rowStatus(row: unknown): string {
	if (typeof row !== 'object' || row === null) return '';
	const s = (row as { status?: unknown }).status;
	return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

/**
 * ASYNC index build の完了を poll する。
 *
 * - status='completed' の row が現れたら成功で resolve。
 * - status='failed' の row が現れたら **即 throw** (dedup すり抜けを防ぐ、F3 hard 制約)。
 * - row 未登録 / processing の間は intervalMs 待って再 query。
 * - timeoutMs 超過で throw。
 *
 * @param executor autocommit で SELECT を実行できる raw executor。
 * @param indexName ASYNC で作成した index 名 (unquoted)。object_name は `public.<indexName>`。
 */
export async function pollAsyncIndexBuild(
	executor: RawSqlExecutor,
	indexName: string,
	opts: AsyncIndexPollOptions = {},
): Promise<void> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
	const sleep = opts.sleep ?? defaultSleep;
	const now = opts.now ?? Date.now;

	const objectName = `public.${indexName}`;
	// object_name はリテラル埋め込み。indexName は drizzle schema 由来の識別子 (\w+ のみ、
	// transform.ts で抽出) ゆえ injection リスクはないが、念のため識別子文字に限定する。
	if (!/^\w+$/.test(indexName)) {
		throw new Error(`[dsql-migration] invalid index name for poll: ${indexName}`);
	}
	const query =
		`SELECT status FROM sys.jobs ` +
		`WHERE job_type = 'INDEX_BUILD' AND object_name = '${objectName}'`;

	const start = now();
	for (;;) {
		const { rows } = await executor.execute(query);
		const statuses = rows.map(rowStatus);

		if (statuses.some((s) => s === 'failed')) {
			throw new Error(
				`[dsql-migration] ASYNC index build FAILED for "${indexName}" ` +
					'(sys.jobs INDEX_BUILD status=failed). ' +
					'既存重複により uniqueness validation が失敗した可能性 (clean state で張り直す必要あり、PoC 検証 3)。',
			);
		}
		if (statuses.some((s) => s === 'completed')) {
			return;
		}

		if (now() - start >= timeoutMs) {
			const observed = statuses.length > 0 ? statuses.join(',') : '(no sys.jobs row yet)';
			throw new Error(
				`[dsql-migration] ASYNC index build TIMEOUT for "${indexName}" after ${timeoutMs}ms ` +
					`(last observed status: ${observed}). build 完了前に書込を開放してはならない (F3)。`,
			);
		}
		await sleep(intervalMs);
	}
}

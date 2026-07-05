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
//   → 正しい手順: clean state に ASYNC UNIQUE index を張り、当該 build job の status='completed' を
//     **poll 確認してから書込を開放**する。本モジュールはこの poll を実装する。
//
// ── ⚠️ sys.jobs の履歴保持セマンティクスは PoC 未検証 (未知) ─────────────────
//   PoC 検証 3 は「単一 build の status 遷移」しか観測しておらず、**同一 object の過去 build の
//   行が sys.jobs に残存するか (履歴蓄積 vs 現行 build のみ) は未検証**である。
//   もし過去 build の `completed` 行が残ると、多行を `some(status='completed')` で評価する素朴実装は
//   「今回の build が processing/failed でも即 done」= **fail-open** で dedup すり抜けを招く
//   (検証 3 が防ごうとしている事象そのもの)。逆に過去 `failed` 行で retry が恒久ブロック (fail-close)。
//   → **防御的設計**: (1) runner が CREATE INDEX ASYNC 発行**前**に既存 job の watermark
//     (最新 start_time) を捕捉し、(2) poll は `start_time > watermark` で**今回の build に限定**した
//     うえで **最新 1 行のみ**を保守的に判定する (completed のみ done / failed のみ throw / それ以外は
//     待機継続)。stale 行を「completed だから」と安易に信じない。
//   → sys.jobs の実挙動 (履歴保持 / start_time 列名) は **M4 後半の使い捨てクラスタで実測する
//     follow-up を推奨** (本 poll の query は 1 箇所に集約してあり、実測後の調整が容易)。

/** poll 用の最小 SQL 実行面 (raw 文字列を実行し rows を返す)。runner から注入される。 */
export interface RawSqlExecutor {
	execute(sql: string): Promise<{ rows: unknown[] }>;
}

export interface AsyncIndexPollOptions {
	/** poll 全体の timeout。既定 60_000ms。超過で throw (timeout ハンドリング)。 */
	timeoutMs?: number;
	/** poll 間隔。既定 500ms。 */
	intervalMs?: number;
	/**
	 * 今回の build に限定するための watermark = CREATE INDEX ASYNC 発行**前**に捕捉した
	 * 当該 object の既存 job の最新 start_time (無ければ null)。`start_time > watermark` で
	 * 過去 build 行を除外する。runner が captureIndexBuildWatermark() で取得して渡す。
	 */
	afterWatermark?: string | null;
	/** テスト注入用の sleep。既定 setTimeout。 */
	sleep?: (ms: number) => Promise<void>;
	/** テスト注入用の時刻源。既定 Date.now。 */
	now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 500;

// ⚠️ sys.jobs の time 列名は PoC 未検証。drizzle/AWS doc 慣習の `start_time` を仮採用する。
//   列が存在しない/名称違いなら query が error → migration が fail-close (loud) で止まる
//   (silent fail-open にはならない)。実測後にここだけ直せばよい (query 集約点)。
const JOB_TIME_COLUMN = 'start_time';

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** 値を単一引用リテラルへ安全に埋め込む (SQL literal escaping)。 */
function toSqlLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** index 実名 → sys.jobs.object_name リテラル。改行/NUL 等の危険文字は拒否 (literal escaping と二重防御)。 */
function toObjectNameLiteral(indexName: string): string {
	if (/[\0\r\n]/.test(indexName)) {
		throw new Error(`[dsql-migration] invalid index name for poll (control char): ${indexName}`);
	}
	// ⚠️ schema は drizzle.config の `public` 前提。他 schema の index はこの前提外 (要 follow-up)。
	return toSqlLiteral(`public.${indexName}`);
}

/** sys.jobs の 1 行から status を取り出す (大小無視で正規化)。 */
function rowStatus(row: unknown): string {
	if (typeof row !== 'object' || row === null) return '';
	const s = (row as { status?: unknown }).status;
	return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

/**
 * CREATE INDEX ASYNC 発行**前**に呼び、当該 object の既存 INDEX_BUILD job の watermark
 * (最新 start_time) を捕捉する。過去 build 行が無ければ null。
 * poll はこの watermark より新しい行 = 今回の build に限定して判定する (fail-open 防止)。
 */
export async function captureIndexBuildWatermark(
	executor: RawSqlExecutor,
	indexName: string,
): Promise<string | null> {
	const objectName = toObjectNameLiteral(indexName);
	const { rows } = await executor.execute(
		`SELECT max(${JOB_TIME_COLUMN}) AS watermark FROM sys.jobs ` +
			`WHERE job_type = 'INDEX_BUILD' AND object_name = ${objectName}`,
	);
	const first = rows[0] as { watermark?: unknown } | undefined;
	const wm = first?.watermark;
	if (wm === null || wm === undefined) return null;
	return typeof wm === 'string' ? wm : String(wm);
}

/**
 * ASYNC index build の完了を poll する (今回の build に限定・保守的判定)。
 *
 * - `afterWatermark` で過去 build 行を除外し、`ORDER BY start_time DESC LIMIT 1` で今回の
 *   build の最新 1 行のみを評価する。
 * - 最新行 status='completed' → resolve。
 * - 最新行 status='failed' → **throw** (dedup すり抜けを防ぐ、F3 hard 制約)。
 * - 行が無い / processing 等 → intervalMs 待って再 query (completed を安易に信じない)。
 * - timeoutMs 超過で throw。
 *
 * @param executor autocommit で SELECT を実行できる raw executor。
 * @param indexName ASYNC で作成した index 実名 (引用を外したもの)。object_name = `public.<indexName>`。
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

	const objectName = toObjectNameLiteral(indexName); // 危険文字はここで throw。
	const watermarkFilter =
		opts.afterWatermark != null
			? ` AND ${JOB_TIME_COLUMN} > ${toSqlLiteral(opts.afterWatermark)}`
			: '';
	// 今回の build (watermark より新しい) の最新 1 行のみを取得 → 多行 fail-open を構造的に排除。
	const query =
		`SELECT status FROM sys.jobs ` +
		`WHERE job_type = 'INDEX_BUILD' AND object_name = ${objectName}${watermarkFilter} ` +
		`ORDER BY ${JOB_TIME_COLUMN} DESC LIMIT 1`;

	const start = now();
	for (;;) {
		const { rows } = await executor.execute(query);
		// LIMIT 1 前提で最新 1 行のみ判定する (driver が LIMIT 無視で多行返しても latest=rows[0])。
		const latest = rows.length > 0 ? rowStatus(rows[0]) : '';

		if (latest === 'failed') {
			throw new Error(
				`[dsql-migration] ASYNC index build FAILED for "${indexName}" ` +
					'(sys.jobs INDEX_BUILD 最新 job status=failed)。' +
					'既存重複により uniqueness validation が失敗した可能性 (clean state で張り直す必要あり、PoC 検証 3)。',
			);
		}
		if (latest === 'completed') {
			return;
		}

		if (now() - start >= timeoutMs) {
			throw new Error(
				`[dsql-migration] ASYNC index build TIMEOUT for "${indexName}" after ${timeoutMs}ms ` +
					`(last observed status: ${latest || '(no matching sys.jobs row yet)'}). ` +
					'build 完了前に書込を開放してはならない (F3)。',
			);
		}
		await sleep(intervalMs);
	}
}

// src/lib/server/db/dsql/occ-retry.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A) / 設計 SSOT: docs/design/dsql-data-model.md §8 / spike#4,#8
//
// DSQL OCC (楽観的同時実行制御) の 40001 retry ラッパ。
// DSQL は snapshot isolation + ロック無しで実行し、commit 時に adjudicator が同一行の
// write-write 競合を検出して SQLSTATE 40001 (OC000) を返す (AWS Concurrency control blog /
// spike#8 実測: 同一行 M=8 で 6 件、異なる行で 0 件)。40001 は「txn 全体を再実行せよ」の
// 活性化シグナルであり、business error (23505 重複等) を retry すると二重付与になるため
// 40001 のみを bounded retry する。
//
// ⚠️ retry は冪等性を保証しない (§8: 冪等性の正は「txn 内 re-read」)。work 側が再実行可能
// であることは runInTransaction port (transaction.interface.ts) の契約。

export interface OccRetryOptions {
	/** 総試行回数 (初回含む)。既定 3 (家庭スケールでは親子同時記録の稀な衝突のみ、§8)。 */
	maxAttempts?: number;
	/** backoff 基準 ms。attempt n の待機 = baseDelayMs * 2^(n-1) + jitter。既定 10ms。 */
	baseDelayMs?: number;
}

const DEFAULTS: Required<OccRetryOptions> = { maxAttempts: 3, baseDelayMs: 10 };

/** SQLSTATE 40001 (serialization failure / DSQL OC000) か。pg driver は .code に SQLSTATE を載せる。 */
export function isOccConflict(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as { code?: unknown }).code;
	if (code === '40001') return true;
	// drizzle / driver 層で wrap された場合は cause を 1 段見る。
	const cause = (err as { cause?: unknown }).cause;
	return (
		typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '40001'
	);
}

/** fn を実行し、40001 のみ bounded retry する。他エラーは即 rethrow。 */
export async function withOccRetry<T>(fn: () => Promise<T>, opts?: OccRetryOptions): Promise<T> {
	const { maxAttempts, baseDelayMs } = { ...DEFAULTS, ...opts };
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (!isOccConflict(err)) throw err;
			lastError = err;
			if (attempt < maxAttempts) {
				const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}
	throw lastError;
}

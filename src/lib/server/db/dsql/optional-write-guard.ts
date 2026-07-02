// src/lib/server/db/dsql/optional-write-guard.ts
// EPIC #3424 / 実装 #3541 (#N4-2 Phase C cycle 2) / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#11
//
// optional 書込 (combo / mission / challenge / certificate / 通知) の隔離実行 wrapper。
// §8: optional は additive で core の整合に不要 → 失敗は core を巻き込まず swallow する。
// ただし「行が書かれない欠落」は fitness#14 の派生列突合では drift=0 で**検出不能**
// (DB R1/QM R4/PO R1) → 失敗時に観測カウンタ (metric、ログでない) を emit して
// 欠落率を可観測化する (fitness#11)。
//
// カウンタは injectable: db 層は analytics に依存しない (層分離)。service 層が
// `analytics.trackEvent('optional_write_failed', { name })` 等に bind して使う。

export type OptionalWriteFailureHandler = (name: string, error: unknown) => void;

/**
 * optional 書込を隔離実行する。失敗は swallow して null を返し、onFailure に通知する。
 * @param name 観測カウンタの識別子 ('combo_bonus' / 'mission_bonus' 等)
 * @param fn optional 書込本体 (独立 mini-txn を内包すること — core txn に入れない)
 * @param onFailure 失敗カウンタ emitter (fitness#11。service 層で analytics に bind)
 */
export async function runOptionalWrite<T>(
	name: string,
	fn: () => Promise<T>,
	onFailure: OptionalWriteFailureHandler,
): Promise<T | null> {
	try {
		return await fn();
	} catch (err) {
		try {
			onFailure(name, err);
		} catch {
			// カウンタ emit 自体の失敗で optional 隔離を壊さない (fire-and-forget)。
		}
		return null;
	}
}

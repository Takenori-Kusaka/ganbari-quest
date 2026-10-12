// src/lib/server/describe-error.ts
// logger とは別 module にしてある: logger を vi.mock する test が多く、そこへ関数を足すと
// mock に export が無いと落ちる。純粋関数なので logger に依存させない。

/** cause を辿る段数の上限 (循環参照で止まらなくなるのを防ぐ)。 */
const MAX_CAUSE_DEPTH = 4;

/**
 * エラーを「何が原因で落ちたか」が読める 1 行に整える (#5049)。
 *
 * Drizzle は DB ドライバのエラーを `Failed query: <SQL> params: ...` で包み、原因 (SQLSTATE /
 * constraint / ドライバのメッセージ) は `cause` に入れる。`error.message` だけを出すと SQL しか
 * 残らず、一意制約違反なのか OCC 競合 (40001) なのか判別できなかった。cause を辿り、
 * `code` / `constraint` / `detail` があれば添える。
 */
export function describeError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const parts: string[] = [err.message];
	let current: unknown = (err as { cause?: unknown }).cause;
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;
		depth++
	) {
		if (current instanceof Error) {
			const meta = current as { code?: unknown; constraint?: unknown; detail?: unknown };
			const attrs = (['code', 'constraint', 'detail'] as const)
				.filter((k) => typeof meta[k] === 'string')
				.map((k) => `${k}=${String(meta[k])}`);
			parts.push(`cause: ${current.message}${attrs.length > 0 ? ` (${attrs.join(' ')})` : ''}`);
			current = (current as { cause?: unknown }).cause;
		} else {
			parts.push(`cause: ${String(current)}`);
			break;
		}
	}
	return parts.join(' | ');
}

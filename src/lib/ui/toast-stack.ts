// src/lib/ui/toast-stack.ts
// #3225 (EPIC #3217): Toast スタックの dedup + stack-cap ロジック (純粋関数、テスト可能)。
//
// error Toast は WCAG 2.2.1 に従い自動消滅させない (Toast.svelte)。そのため連続失敗で
// 非消滅 Toast が積み上がり、× ボタンや子供 UI を覆い得る。以下 2 つで抑制する:
//   - dedup: 同一 (title / description / type) の Toast を多重表示しない
//   - stack-cap: 同時表示数を MAX_TOASTS で上限化し、超過時は最古を 1 件落とす

export interface ToastItem {
	id: number;
	title: string;
	description?: string;
	type: 'success' | 'error' | 'info';
}

/** Toast 同時表示数の上限 (#3225)。 */
export const MAX_TOASTS = 4;

/**
 * 既存スタックに新 Toast を追加した次状態を返す。
 *   - 同一 (title / description / type) が既存なら多重表示せず **current をそのまま返す**
 *     (呼出側は参照同一性で dedup を検知できる)。
 *   - 追加後に max を超えたら最古から溢れた分を切り捨てる。
 */
export function reconcileToastStack(
	current: ToastItem[],
	incoming: ToastItem,
	max: number = MAX_TOASTS,
): ToastItem[] {
	const isDuplicate = current.some(
		(t) =>
			t.title === incoming.title &&
			t.description === incoming.description &&
			t.type === incoming.type,
	);
	if (isDuplicate) return current;
	const next = [...current, incoming];
	return next.length > max ? next.slice(next.length - max) : next;
}

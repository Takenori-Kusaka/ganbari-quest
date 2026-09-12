// src/lib/features/admin/child-limit-optimistic.ts
// #4919: /admin/children で子供を追加すると invalidateAll の再読込タイミングによっては
// 一覧・上限バナーがすぐに更新されない不具合の対策。
//
// `src/routes/(parent)/admin/children/+page.svelte` は action が返す `addedChild` を
// invalidateAll の完了を待たずに一覧へ楽観追加する。上限バナー/ボタンの切り替えも同じ
// 楽観追加件数を使って即座に反映する必要があるため、その算出ロジックを純関数として
// 切り出し独立にテストできるようにする (component 内 `$derived` に閉じ込めると
// 上限到達の境界値をユニットテストで固定できない)。

export interface ChildLimitLike {
	allowed: boolean;
	current: number;
	max: number | null;
}

/**
 * サーバー確定済みの `childLimit` に、まだ invalidateAll で reconciled されていない
 * 楽観追加件数 (`optimisticCount`) を足し込んだ表示用の値を返す。
 *
 * - `limit` が無ければそのまま返す (無制限プラン等、呼び出し元は上限 UI を出さない)
 * - `optimisticCount` が 0 なら同じ値を返す (追加直後以外は無関係)
 * - `max === null` は無制限プランの意味なので常に `allowed: true`
 */
export function computeOptimisticChildLimit(
	limit: ChildLimitLike | undefined,
	optimisticCount: number,
): ChildLimitLike | undefined {
	if (!limit || optimisticCount === 0) return limit;
	const current = limit.current + optimisticCount;
	return {
		...limit,
		current,
		allowed: limit.max === null ? true : current < limit.max,
	};
}

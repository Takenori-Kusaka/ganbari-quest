// #3963: 型の SSOT は $lib/domain/constants/plan-tier.ts に集約した。
// ここで同じ union を再宣言すると 2 つ目の定義になり、プラン追加時に片方だけ更新される。
import type { PlanTier } from '$lib/domain/constants/plan-tier';

export type { PlanTier };

/**
 * プランティアの序列（`free < standard < family`）。
 *
 * FeatureGate.svelte / tutorial-chapters.ts が同じ `{ free: 0, standard: 1, family: 2 }` を
 * それぞれ直書きしていた。page-guide にも同じ requiredTier 判定を入れるにあたり、3 箇所目の
 * 重複を作る前に SSOT へ集約した（同型定数の重複防止）。requiredTier 判定は本定数を参照する。
 */
export const TIER_ORDER: Record<PlanTier, number> = { free: 0, standard: 1, family: 2 };

/**
 * 現在のプランティアが `requiredTier` を満たすか（= その手順を表示してよいか）。
 *
 * `requiredTier` 未指定（undefined）は全プランで表示する。
 * tutorial-chapters / page-guide の両 requiredTier フィルタが本関数を共有し、判定基準の drift を防ぐ。
 */
export function meetsRequiredTier(planTier: PlanTier, requiredTier?: PlanTier): boolean {
	if (!requiredTier) return true;
	return TIER_ORDER[planTier] >= TIER_ORDER[requiredTier];
}

/**
 * チュートリアルが遷移しうるページ。
 *
 * `string` のままだと `goto(step.page)` に SvelteKit の `resolve()` を通せず
 * (`resolve` は route id / pathname リテラルを要求する)、
 * `svelte/no-navigation-without-resolve` を満たせない。実在ルートの union に絞ることで
 * 遷移先の typo をコンパイル時に落としつつ `resolve()` 経由の遷移に統一する。
 */
export type TutorialPage =
	| '/admin'
	| '/admin/activities'
	| '/admin/cheer'
	| '/admin/children'
	| '/admin/points'
	| '/admin/reports'
	| '/admin/rewards'
	| '/admin/settings';

export interface TutorialStep {
	id: string;
	chapterId: number;
	selector?: string;
	title: string;
	description: string;
	position: 'top' | 'bottom' | 'left' | 'right' | 'auto';
	page?: TutorialPage;
	/** この手順を表示する最低プランティア（省略時は全プラン表示） */
	requiredTier?: PlanTier;
}

export interface TutorialChapter {
	id: number;
	title: string;
	icon: string;
	steps: TutorialStep[];
}

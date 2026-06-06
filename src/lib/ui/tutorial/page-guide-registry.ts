/**
 * ページガイドレジストリ
 *
 * 全ページのガイド定義を集約し、パスベースで取得する。
 */

import type { PageGuide } from './page-guide-types';
import { meetsRequiredTier, type PlanTier } from './tutorial-types';

// 動的インポートでガイド定義を取得（バンドルサイズ最適化）
const GUIDE_LOADERS: Record<
	string,
	() => Promise<{ default?: PageGuide } & Record<string, PageGuide>>
> = {
	'/admin': () => import('../../../routes/(parent)/admin/_guide'),
	'/admin/children': () => import('../../../routes/(parent)/admin/children/_guide'),
	'/admin/activities': () => import('../../../routes/(parent)/admin/activities/_guide'),
	'/admin/rewards': () => import('../../../routes/(parent)/admin/rewards/_guide'),
	// #2905: #2294 EPIC 新設ページ (checklists / challenges) + status を登録し、
	// ❓ ページガイドが全 admin ページで機能する規約を回復する (PO 指摘 #8)。
	'/admin/checklists': () => import('../../../routes/(parent)/admin/checklists/_guide'),
	'/admin/challenges': () => import('../../../routes/(parent)/admin/challenges/_guide'),
	'/admin/status': () => import('../../../routes/(parent)/admin/status/_guide'),
	'/admin/points': () => import('../../../routes/(parent)/admin/points/_guide'),
	'/admin/reports': () => import('../../../routes/(parent)/admin/reports/_guide'),
	// #2270 / #2274 (EPIC #2266): /admin/messages 廃止 → /admin/cheer (応援) に統合
	'/admin/cheer': () => import('../../../routes/(parent)/admin/cheer/_guide'),
	'/admin/settings': () => import('../../../routes/(parent)/admin/settings/_guide'),
};

// ガイド名とモジュールのエクスポート名のマッピング
const GUIDE_EXPORT_NAMES: Record<string, string> = {
	'/admin': 'ADMIN_HOME_GUIDE',
	'/admin/children': 'CHILDREN_GUIDE',
	'/admin/activities': 'ACTIVITIES_GUIDE',
	'/admin/rewards': 'REWARDS_GUIDE',
	// #2905: 新設 3 ページの export 名マッピング
	'/admin/checklists': 'CHECKLISTS_GUIDE',
	'/admin/challenges': 'CHALLENGES_GUIDE',
	'/admin/status': 'STATUS_GUIDE',
	'/admin/points': 'POINTS_GUIDE',
	'/admin/reports': 'REPORTS_GUIDE',
	// #2270 / #2274 (EPIC #2266): /admin/messages 廃止 → /admin/cheer に統合
	'/admin/cheer': 'CHEER_GUIDE',
	'/admin/settings': 'SETTINGS_GUIDE',
};

/**
 * パスに対応するページガイドを取得する。
 * ガイドが存在しないページの場合は null を返す。
 */
export async function getPageGuide(path: string): Promise<PageGuide | null> {
	// パスの正規化: 末尾スラッシュ除去、クエリパラメータ除去
	const normalized = path.replace(/\/$/, '').split('?')[0] ?? '';

	const loader = GUIDE_LOADERS[normalized];
	if (!loader) return null;

	try {
		const mod = await loader();
		const exportName = GUIDE_EXPORT_NAMES[normalized] ?? '';
		return (mod as Record<string, PageGuide>)[exportName] ?? null;
	} catch {
		return null;
	}
}

/**
 * ページガイドの手順を現在のプランティアでフィルタする。
 *
 * 各 GuideStep の `requiredTier`（例: challenges-intro の `family`）を満たさない手順を除外し、
 * 残った手順だけのガイドを返す。これにより free ユーザーには「上位プラン限定機能」の手順を見せず、
 * 「設定したのに使えない」混乱（NN/G #1 visibility / #5 error prevention）を防ぐ。
 *
 * 判定は tutorial-chapters / FeatureGate と同じ {@link meetsRequiredTier}（TIER_ORDER SSOT）を共有する。
 * 全手順が除外された場合は `null` を返し、呼び出し側でガイド起動を抑止できるようにする。
 *
 * @param guide フィルタ対象のページガイド
 * @param planTier 現在のプランティア
 * @returns requiredTier を満たす手順だけのガイド。残手順が 0 なら null
 */
export function filterGuideStepsByTier(guide: PageGuide, planTier: PlanTier): PageGuide | null {
	const steps = guide.steps.filter((step) => meetsRequiredTier(planTier, step.requiredTier));
	if (steps.length === 0) return null;
	return { ...guide, steps };
}

/** 全ガイドのページID一覧（完了状態表示用） */
export const ALL_PAGE_IDS = [
	'admin-home',
	'admin-children',
	'admin-activities',
	'admin-rewards',
	// #2905: 新設 3 ページの pageId
	'admin-checklists',
	'admin-challenges',
	'admin-status',
	'admin-points',
	'admin-reports',
	// #2270 / #2274 (EPIC #2266): admin-messages 廃止 → admin-cheer (応援) に統合
	'admin-cheer',
	'admin-settings',
];

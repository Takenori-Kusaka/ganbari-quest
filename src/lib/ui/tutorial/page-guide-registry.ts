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
	// #3267 (EPIC #3260 C3): プラン・課金 + お支払い
	'/admin/subscription': () => import('../../../routes/(parent)/admin/subscription/_guide'),
	'/admin/billing': () => import('../../../routes/(parent)/admin/billing/_guide'),
	// #3263 (EPIC #3260 F2): marketplace は AdminLayout 非使用だが admin 取込 CUJ の着地先のため
	// ガイドを登録する。詳細ルート /marketplace/[type]/[itemId] は親パスフォールバック (#3262 F1)
	// で本 /marketplace ガイドに degrade する。
	'/marketplace': () => import('../../../routes/marketplace/_guide'),
};

/** registry に dedicated guide が登録済のパス一覧（#3262 F1: 網羅 gate test 用）。 */
export const REGISTERED_GUIDE_PATHS = Object.keys(GUIDE_LOADERS);

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
	// #3267 (EPIC #3260 C3)
	'/admin/subscription': 'SUBSCRIPTION_GUIDE',
	'/admin/billing': 'BILLING_GUIDE',
	// #3263 (EPIC #3260 F2)
	'/marketplace': 'MARKETPLACE_GUIDE',
};

/**
 * 正規化パスから「自身 → 親 → 祖先」の候補パスを最も具体的な順で返す（#3262 F1）。
 * 例: `/admin/settings/account` → ['/admin/settings/account', '/admin/settings', '/admin']
 */
export function guideCandidatePaths(normalized: string): string[] {
	const parts = normalized.split('/').filter(Boolean);
	const out: string[] = [];
	for (let n = parts.length; n >= 1; n--) {
		out.push(`/${parts.slice(0, n).join('/')}`);
	}
	return out;
}

/**
 * パスに対応するページガイドを取得する。
 *
 * #3262 F1: 完全一致が無い場合は**親パスにフォールバック**する（最も具体的な登録済み祖先を採用）。
 * これにより設定サブページ等の未登録パスでも親（ハブ）ガイドに degrade し、`?` ボタンが
 * 空にならない（dead-end 防止）。個別最適ガイドは各 Content sub-issue (C1〜C7) で付与する。
 * いずれの候補も未登録なら null。
 */
export async function getPageGuide(path: string): Promise<PageGuide | null> {
	// パスの正規化: 末尾スラッシュ除去、クエリパラメータ除去
	const normalized = path.replace(/\/$/, '').split('?')[0] ?? '';

	for (const candidate of guideCandidatePaths(normalized)) {
		const loader = GUIDE_LOADERS[candidate];
		if (!loader) continue;
		try {
			const mod = await loader();
			const exportName = GUIDE_EXPORT_NAMES[candidate] ?? '';
			const guide = (mod as Record<string, PageGuide>)[exportName] ?? null;
			if (guide) return guide;
		} catch {
			// この候補の読込失敗 → 次の親候補を試す
		}
	}
	return null;
}

/**
 * ページガイドの手順を現在のプランティアでフィルタする。
 *
 * 各 GuideStep の `requiredTier`（例: activities-add の `standard`）を満たさない手順を除外し、
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

/**
 * ページガイドの手順を実行モードでフィルタする（#3291）。
 *
 * `requiredRuntime: 'saas'` を持つ手順は NUC セルフホスト版（`nuc-prod`）では除外する。
 * 例: /admin/subscription は `nuc-prod` で `NucLicensePanel`（現在のプラン / プラン管理
 * セクション無し）を描画するため、SaaS 専用手順（`subscription-current-plan` /
 * `subscription-plan-management`）の selector が解決できず空 spotlight になる + NUC に
 * 無い操作（プラン選択 / Stripe Portal）を案内してしまう（ADR-0013 truth 違反）。
 * SaaS（`aws-prod` / `local-debug` / `demo` / `build`）では全手順を表示する。
 *
 * {@link filterGuideStepsByTier} と同型（filter → 残 0 なら null）。両者を直列適用できる。
 *
 * @param guide フィルタ対象のページガイド
 * @param runtimeMode 現在の実行モード（ADR-0040、`locals.runtimeMode` 由来）
 * @returns 当該モードで表示すべき手順だけのガイド。残手順が 0 なら null
 */
export function filterGuideStepsByRuntime(
	guide: PageGuide,
	runtimeMode: string | undefined,
): PageGuide | null {
	const isNuc = runtimeMode === 'nuc-prod';
	const steps = guide.steps.filter((step) => !(isNuc && step.requiredRuntime === 'saas'));
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
	// #3267 (EPIC #3260 C3)
	'admin-subscription',
	'admin-billing',
	// #3263 (EPIC #3260 F2)
	'marketplace',
];

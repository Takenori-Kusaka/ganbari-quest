/**
 * ページガイドレジストリ
 *
 * 全ページのガイド定義を集約し、パスベースで取得する。
 */

// #3314: 動的セグメント（[type]/[itemId]）を含むパスの動的 import は Vite/Rollup の
// build で chunk が emit されず runtime で reject する（literal bracket path を dynamic import が
// 解決できない）。reject は getPageGuide の catch に飲まれ親 /marketplace 一覧ガイドへ silent
// degrade していた。bracket path の guide のみ static import で確実に bundle へ取り込む
// （admin 系の () group path は dynamic import で正しく bundle されるため従来どおり）。
import { MARKETPLACE_DETAIL_GUIDE } from '../../../routes/marketplace/[type]/[itemId]/_guide';
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
	// #3266 (EPIC #3260 C2): 設定サブ 6 ページ個別ガイド（getPageGuide は最具体一致が先に効くため
	// /admin/settings/<sub> は親 /admin/settings より優先される）。
	'/admin/settings/account': () => import('../../../routes/(parent)/admin/settings/account/_guide'),
	'/admin/settings/activities': () =>
		import('../../../routes/(parent)/admin/settings/activities/_guide'),
	'/admin/settings/notifications': () =>
		import('../../../routes/(parent)/admin/settings/notifications/_guide'),
	'/admin/settings/data': () => import('../../../routes/(parent)/admin/settings/data/_guide'),
	'/admin/settings/rules': () => import('../../../routes/(parent)/admin/settings/rules/_guide'),
	'/admin/settings/support': () => import('../../../routes/(parent)/admin/settings/support/_guide'),
	// #3267 (EPIC #3260 C3): プラン・課金 + お支払い
	'/admin/subscription': () => import('../../../routes/(parent)/admin/subscription/_guide'),
	'/admin/billing': () => import('../../../routes/(parent)/admin/billing/_guide'),
	// #3263 (EPIC #3260 F2): marketplace は AdminLayout 非使用だが admin 取込 CUJ の着地先のため
	// ガイドを登録する。
	'/marketplace': () => import('../../../routes/marketplace/_guide'),
	// #3269 (EPIC #3260 C5): marketplace 詳細 (取込 CTA) は parameterized route のため
	// 動的セグメントを含む。GUIDE_LOADERS の key には route パターン表記 [type]/[itemId] を用い、
	// 実パス (例: /marketplace/activity-pack/kinder-starter) は PARAMETERIZED_GUIDE_MATCHERS
	// 経由で本 key に解決する (#3262 F1 親フォールバックより前段で dedicated guide を優先採用)。
	// #3314: bracket path は dynamic import が build で解決できないため static import 済の
	// 定数を Promise でラップして返す（loader interface は維持、確実に bundle される）。
	'/marketplace/[type]/[itemId]': () => Promise.resolve({ MARKETPLACE_DETAIL_GUIDE }),
	// #3268 (EPIC #3260 C4): 家族メンバー / パック
	'/admin/members': () => import('../../../routes/(parent)/admin/members/_guide'),
	'/admin/packs': () => import('../../../routes/(parent)/admin/packs/_guide'),
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ。getPageGuide は最具体一致が先に効くため
	// /admin/rewards/requests は親 /admin/rewards より本ガイドが優先される。
	'/admin/certificates': () => import('../../../routes/(parent)/admin/certificates/_guide'),
	'/admin/growth-book': () => import('../../../routes/(parent)/admin/growth-book/_guide'),
	'/admin/rewards/requests': () => import('../../../routes/(parent)/admin/rewards/requests/_guide'),
};

/** registry に dedicated guide が登録済のパス一覧（#3262 F1: 網羅 gate test 用）。 */
export const REGISTERED_GUIDE_PATHS = Object.keys(GUIDE_LOADERS);

/**
 * パラメータ付きルートの実パスを GUIDE_LOADERS の route パターン key に解決する matcher (#3269)。
 *
 * `guideCandidatePaths` は実パスの祖先を literal に辿るだけで動的セグメント (`[type]` 等) を
 * 表現できない。そこで実パスを正規表現で照合し、一致したら対応する登録済みパターン key を
 * 返す。getPageGuide はこの結果を**親フォールバックより前に**試すため、詳細ルートでは
 * dedicated guide が `/marketplace` への degrade を上書きする。
 */
const PARAMETERIZED_GUIDE_MATCHERS: { re: RegExp; key: string }[] = [
	// /marketplace/<type>/<itemId> (末尾 2 セグメント、追加セグメント無し) → 詳細ガイド
	{ re: /^\/marketplace\/[^/]+\/[^/]+$/, key: '/marketplace/[type]/[itemId]' },
];

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
	// #3266 (EPIC #3260 C2): 設定サブ 6 ページ
	'/admin/settings/account': 'SETTINGS_ACCOUNT_GUIDE',
	'/admin/settings/activities': 'SETTINGS_ACTIVITIES_GUIDE',
	'/admin/settings/notifications': 'SETTINGS_NOTIFICATIONS_GUIDE',
	'/admin/settings/data': 'SETTINGS_DATA_GUIDE',
	'/admin/settings/rules': 'SETTINGS_RULES_GUIDE',
	'/admin/settings/support': 'SETTINGS_SUPPORT_GUIDE',
	// #3267 (EPIC #3260 C3)
	'/admin/subscription': 'SUBSCRIPTION_GUIDE',
	'/admin/billing': 'BILLING_GUIDE',
	// #3263 (EPIC #3260 F2)
	'/marketplace': 'MARKETPLACE_GUIDE',
	// #3269 (EPIC #3260 C5): marketplace 詳細 dedicated guide
	'/marketplace/[type]/[itemId]': 'MARKETPLACE_DETAIL_GUIDE',
	// #3268 (EPIC #3260 C4): 家族メンバー / パック
	'/admin/members': 'MEMBERS_GUIDE',
	'/admin/packs': 'PACKS_GUIDE',
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ
	'/admin/certificates': 'CERTIFICATES_GUIDE',
	'/admin/growth-book': 'GROWTH_BOOK_GUIDE',
	'/admin/rewards/requests': 'REWARDS_REQUESTS_GUIDE',
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
 * 正規化パスに対するガイド候補 key を「最も具体的な順」で返す（#3262 F1 + #3269）。
 *
 * #3269: 動的セグメントを含む route（例 `/marketplace/<type>/<itemId>`）は
 * PARAMETERIZED_GUIDE_MATCHERS で登録済みパターン key に解決し、literal な祖先
 * フォールバック（guideCandidatePaths）より**前段**に並べる。これにより詳細 dedicated
 * guide が親 `/marketplace` ガイドへの degrade を上書きする。
 */
function resolveGuideCandidateKeys(normalized: string): string[] {
	const out: string[] = [];
	for (const { re, key } of PARAMETERIZED_GUIDE_MATCHERS) {
		if (re.test(normalized)) out.push(key);
	}
	out.push(...guideCandidatePaths(normalized));
	return out;
}

/**
 * パスに対応するページガイドを取得する。
 *
 * #3262 F1: 完全一致が無い場合は**親パスにフォールバック**する（最も具体的な登録済み祖先を採用）。
 * これにより設定サブページ等の未登録パスでも親（ハブ）ガイドに degrade し、`?` ボタンが
 * 空にならない（dead-end 防止）。
 * #3269: 動的セグメントを含む詳細ルートは PARAMETERIZED_GUIDE_MATCHERS で dedicated guide を
 * 親フォールバックより優先解決する。いずれの候補も未登録なら null。
 */
export async function getPageGuide(path: string): Promise<PageGuide | null> {
	// パスの正規化: 末尾スラッシュ除去、クエリパラメータ除去
	const normalized = path.replace(/\/$/, '').split('?')[0] ?? '';

	for (const candidate of resolveGuideCandidateKeys(normalized)) {
		const loader = GUIDE_LOADERS[candidate];
		if (!loader) continue;
		try {
			const mod = await loader();
			const exportName = GUIDE_EXPORT_NAMES[candidate] ?? '';
			const guide = (mod as Record<string, PageGuide>)[exportName] ?? null;
			if (guide) return guide;
		} catch (err) {
			// この候補の読込失敗 → 次の親候補を試す。
			// #3314: 登録済 loader の reject を黙殺すると、本来出るべき dedicated guide が
			// 親へ silent degrade する（detail→list 退行を E2E まで気付けなかった原因）。
			// 開発時に loader 失敗を可視化し、build/bundle 由来の解決失敗を早期検知する。
			if (typeof console !== 'undefined') {
				console.warn(`[page-guide] loader failed for "${candidate}", falling back to parent`, err);
			}
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
 * SaaS 系の実行モード集合（ADR-0040、`nuc-prod` 以外）。`requiredRuntime: 'saas'` 手順の
 * 表示可否判定に使う。集合に明示列挙することで、未知 / undefined な runtimeMode は
 * fail-closed（saas / nuc いずれの限定手順も除外）になる（#3296 Part 3）。
 */
const SAAS_RUNTIME_MODES = new Set<string>(['build', 'demo', 'local-debug', 'aws-prod']);

/**
 * ページガイドの手順を実行モードでフィルタする（#3291 / #3296）。
 *
 * - `requiredRuntime: 'saas'` 手順は SaaS（`build` / `demo` / `local-debug` / `aws-prod`）でのみ表示。
 *   NUC（`nuc-prod`）では `NucLicensePanel`（現在のプラン / プラン管理セクション無し）を描画するため、
 *   selector 未解決の空 spotlight + 実装にない操作案内（ADR-0013 truth 違反）になるので除外する。
 * - `requiredRuntime: 'nuc'` 手順は NUC でのみ表示し、SaaS では除外（#3296、NucLicensePanel 固有の
 *   Edition badge / 利用状況を spotlight する NUC 専用手順）。
 * - `requiredRuntime` 未指定の手順は全モードで表示する。
 *
 * **fail-closed（#3296 Part 3）**: `runtimeMode` が undefined / 未知値のときは saas / nuc いずれの
 * 限定手順も**除外**する。`locals.runtimeMode` 配布（#2327/#2328）が regression したとき、NUC に
 * SaaS 専用手順が露出して実装にない操作を案内する（ADR-0013 違反）リスクを断つため、安全側に倒す。
 * 結果として未確定時は `requiredRuntime` 無しの手順（intro 等）だけが残る。
 *
 * {@link filterGuideStepsByTier} / {@link filterGuideStepsByStripe} と同型（filter → 残 0 なら null）。
 * 三者を直列適用できる。
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
	const isSaas = runtimeMode !== undefined && SAAS_RUNTIME_MODES.has(runtimeMode);
	const steps = guide.steps.filter((step) => {
		switch (step.requiredRuntime) {
			case 'saas':
				return isSaas;
			case 'nuc':
				return isNuc;
			default:
				return true;
		}
	});
	if (steps.length === 0) return null;
	return { ...guide, steps };
}

/**
 * ページガイドの手順を Stripe 決済の有効性でフィルタする（#3296）。
 *
 * `requiredStripe: 'enabled'` 手順は `stripeEnabled === true` のときのみ表示する。
 * 例: `subscription-plan-management` は `SaasLicensePanel` の `{#if stripeEnabled}` ブロック内
 * （プラン管理セクション）を spotlight するため、Stripe 無効（`STRIPE_SECRET_KEY` 未設定）な
 * `local-debug` / `demo` では selector 未解決 → 空 spotlight になる。これは runtimeMode='saas' 軸
 * とは直交する同クラスの空 spotlight（ADR-0061 same-class）であり、本フィルタで塞ぐ。
 *
 * **fail-closed**: `stripeEnabled` が undefined のときも除外する（配布 regression 時に
 * 描画されない UI を spotlight しない安全側）。
 *
 * {@link filterGuideStepsByRuntime} と同型（filter → 残 0 なら null）。直列適用できる。
 *
 * @param guide フィルタ対象のページガイド
 * @param stripeEnabled `isStripeEnabled()` 由来（admin `+layout.server.ts` が配布）
 * @returns Stripe 有効性に整合する手順だけのガイド。残手順が 0 なら null
 */
export function filterGuideStepsByStripe(
	guide: PageGuide,
	stripeEnabled: boolean | undefined,
): PageGuide | null {
	const steps = guide.steps.filter(
		(step) => step.requiredStripe !== 'enabled' || stripeEnabled === true,
	);
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
	// #3266 (EPIC #3260 C2): 設定サブ 6 ページ
	'admin-settings-account',
	'admin-settings-activities',
	'admin-settings-notifications',
	'admin-settings-data',
	'admin-settings-rules',
	'admin-settings-support',
	// #3267 (EPIC #3260 C3)
	'admin-subscription',
	'admin-billing',
	// #3263 (EPIC #3260 F2)
	'marketplace',
	// #3269 (EPIC #3260 C5): marketplace 詳細 dedicated guide
	'marketplace-detail',
	// #3268 (EPIC #3260 C4): 家族メンバー / パック
	'admin-members',
	'admin-packs',
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ
	'admin-certificates',
	'admin-growth-book',
	'admin-rewards-requests',
];

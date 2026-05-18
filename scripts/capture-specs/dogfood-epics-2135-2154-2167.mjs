/**
 * scripts/capture-specs/dogfood-epics-2135-2154-2167.mjs
 *
 * Dev session SS dogfood spec for 3 EPICs AC3 (Issue #2135 / #2154 / #2167)。
 * `capture.mjs --config` で読み込む。本番ルート (`/(child)/[uiMode]/...`) を
 * demo Lambda 同型 env (`AUTH_MODE=anonymous` + `DATA_SOURCE=demo`) で撮影し、
 * `selectedChildId` cookie pre-set で `/switch` redirect をバイパスする。
 *
 * 起動: `AUTH_MODE=anonymous DATA_SOURCE=demo npx vite dev --port 5173`
 * 撮影: `MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *          --config scripts/capture-specs/dogfood-epics-2135-2154-2167.mjs \
 *          --out docs/screenshots/dogfood-2135-2154-2167`
 *
 * 撮影元 URL は本番ルート (`/(child)/[uiMode]/shop` / `(character)/history` /
 * `/marketplace` 等)、デモ固有 UI が映らない `?screenshot=all` を強制付与する。
 *
 * demo fixture 5 子供 (SSOT: `src/lib/server/demo/demo-data.ts`):
 *   baby (1歳)        → childId 901 たろうくん
 *   preschool (5歳)   → childId 902 ひなちゃん
 *   elementary (8歳)  → childId 903 けんたくん
 *   junior (14歳)     → childId 904 さくらちゃん
 *   senior (17歳)     → childId 906 けいすけくん
 *
 * AC3 充足項目:
 *   #2135 AC3: 4 type の import + アプリ反映 (marketplace + admin 反映画面)
 *   #2154 AC3: 全 5 年齢モード ショップ → Dialog 確認 → 交換完了 通し体験
 *     (Dialog / Confetti は user-gesture 後の発火のため capture.mjs 自動撮影不可、
 *      unit test `tests/unit/features/reward-celebration.test.ts` + E2E
 *      `tests/e2e/child-shop-exchange.spec.ts` で挙動担保。本 spec は
 *      Phase 1 = ショップ画面初期状態を撮影)
 *   #2167 AC3: 全 5 年齢モード 達成通知 → bell+badge → history 画面 時系列確認
 *     (Phase 1 = 子供 home でヘッダー bell badge を含めた画面、Phase 2 = history
 *      4 タブ各々)
 */

/**
 * #2154 AC3 — 全 5 年齢モード ショップ画面 (Phase 1: 初期状態)。
 * Phase 2 (Dialog) / Phase 3 (Confetti) は user-gesture 後発火のため対象外、
 * unit test + E2E で挙動担保 (PR #2229 と同方針)。
 */
const SHOP_SCREENSHOTS = [
	{
		url: '/baby/shop?screenshot=all',
		name: 'epic-2154-shop-baby',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
		cookies: [{ name: 'selectedChildId', value: '901' }],
	},
	{
		url: '/preschool/shop?screenshot=all',
		name: 'epic-2154-shop-preschool',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
		cookies: [{ name: 'selectedChildId', value: '902' }],
	},
	{
		url: '/elementary/shop?screenshot=all',
		name: 'epic-2154-shop-elementary',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
		cookies: [{ name: 'selectedChildId', value: '903' }],
	},
	{
		url: '/junior/shop?screenshot=all',
		name: 'epic-2154-shop-junior',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
		cookies: [{ name: 'selectedChildId', value: '904' }],
	},
	{
		url: '/senior/shop?screenshot=all',
		name: 'epic-2154-shop-senior',
		presets: ['mobile', 'desktop'],
		selector: '[data-testid="shop-page"]',
		cookies: [{ name: 'selectedChildId', value: '906' }],
	},
];

/**
 * #2167 AC3 Phase 1 — 全 5 年齢モード ホーム (header bell + badge を含む)。
 * baby は ADR-0011 に従い MilestoneBellButton 非対象 (SS は撮るが badge 0 件)。
 */
const HOME_BELL_SCREENSHOTS = [
	{
		url: '/baby/home?screenshot=all',
		name: 'epic-2167-home-baby',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '901' }],
	},
	{
		url: '/preschool/home?screenshot=all',
		name: 'epic-2167-home-preschool',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '902' }],
	},
	{
		url: '/elementary/home?screenshot=all',
		name: 'epic-2167-home-elementary',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '903' }],
	},
	{
		url: '/junior/home?screenshot=all',
		name: 'epic-2167-home-junior',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '904' }],
	},
	{
		url: '/senior/home?screenshot=all',
		name: 'epic-2167-home-senior',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '906' }],
	},
];

/**
 * #2167 AC3 Phase 2 — history 4 タブ階層 (活動 / 達成 / 交換 / 記念)。
 * preschool / elementary 代表で撮影 (baby は対象外、junior/senior は preschool/elementary と
 * variant のみ違いで構造同じ、PR #2237 で全 4 年齢分撮影済のため本 spec では追加 PR-level の
 * 通し体験を補完するための 2 年齢のみ)。
 */
const HISTORY_TABS_SCREENSHOTS = [
	{
		url: '/preschool/history?kind=activities&screenshot=all',
		name: 'epic-2167-history-preschool-activities',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '902' }],
	},
	{
		url: '/preschool/history?kind=achievements&screenshot=all',
		name: 'epic-2167-history-preschool-achievements',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '902' }],
	},
	{
		url: '/preschool/history?kind=purchases&screenshot=all',
		name: 'epic-2167-history-preschool-purchases',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '902' }],
	},
	{
		url: '/preschool/history?kind=milestones&screenshot=all',
		name: 'epic-2167-history-preschool-milestones',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '902' }],
	},
	{
		url: '/elementary/history?kind=activities&screenshot=all',
		name: 'epic-2167-history-elementary-activities',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '903' }],
	},
	{
		url: '/elementary/history?kind=achievements&screenshot=all',
		name: 'epic-2167-history-elementary-achievements',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '903' }],
	},
	{
		url: '/elementary/history?kind=purchases&screenshot=all',
		name: 'epic-2167-history-elementary-purchases',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '903' }],
	},
	{
		url: '/elementary/history?kind=milestones&screenshot=all',
		name: 'epic-2167-history-elementary-milestones',
		presets: ['mobile', 'desktop'],
		cookies: [{ name: 'selectedChildId', value: '903' }],
	},
];

/**
 * #2135 AC3 — マーケットプレイス 4 type 一覧 + アプリ反映先画面。
 * 4 type の import + 反映確認の通し体験を 4 type × 2 画面 (marketplace / 反映先) で撮影。
 */
const MARKETPLACE_4TYPE_SCREENSHOTS = [
	// activity-pack
	{
		url: '/marketplace?type=activity-pack&screenshot=all',
		name: 'epic-2135-marketplace-activity-pack',
		presets: ['mobile', 'desktop'],
	},
	// reward-set
	{
		url: '/marketplace?type=reward-set&screenshot=all',
		name: 'epic-2135-marketplace-reward-set',
		presets: ['mobile', 'desktop'],
	},
	// event-checklist
	{
		url: '/marketplace?type=event-checklist&screenshot=all',
		name: 'epic-2135-marketplace-event-checklist',
		presets: ['mobile', 'desktop'],
	},
	// rule-preset
	{
		url: '/marketplace?type=rule-preset&screenshot=all',
		name: 'epic-2135-marketplace-rule-preset',
		presets: ['mobile', 'desktop'],
	},
];

/** @type {Array<{ url: string; name: string; presets?: string[]; selector?: string; cookies?: Array<{name: string, value: string}> }>} */
export default [
	...SHOP_SCREENSHOTS,
	...HOME_BELL_SCREENSHOTS,
	...HISTORY_TABS_SCREENSHOTS,
	...MARKETPLACE_4TYPE_SCREENSHOTS,
];

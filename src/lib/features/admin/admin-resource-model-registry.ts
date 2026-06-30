/**
 * admin-resource-model-registry.ts — admin リソース管理画面の正準スロット契約 + child-binding モデル SSOT
 * (#3097 / EPIC #3096)
 *
 * admin リソース管理 3 画面 (活動 / チェックリスト / ごほうび) は同じ「admin リソース管理画面」だが、
 * スロット配置順・子供との関係モデル (per-child「子供が持つ」/ family master「配信される」) が
 * 画面ごとにドリフトしていた (PO 約 12 回の指摘でも収束せず)。本 registry を SSOT として、
 *   1. **正準スロット縦順** (CANONICAL_SLOT_ORDER) — 各画面はこの順で「持つスロットだけ」埋める
 *   2. **child-binding モデル** (ADMIN_RESOURCE_MODEL_REGISTRY) — organizing / binding の宣言
 * を 1 箇所に集約する。fitness function (`tests/e2e/admin-resource-layout-contract.spec.ts`) が
 * 各画面の DOM をこの SSOT と照合し、契約逸脱を CI で検出する (Architecture Fitness Function、
 * 『Building Evolutionary Architecture』Neal Ford 他の確立パターン)。
 *
 * 関連: DESIGN.md §10 / ADR-0055 (per-child / family master データモデル) /
 *       tests/e2e/admin-add-path-isomorphism.spec.ts (#2998、add 経路同型性 — 補完関係)
 */

/**
 * admin リソースの「子供との関係モデル」分類。
 *
 * - `organizingModel`:
 *   - `'per-child-tabs'` — 子供タブで「選択中 child のリソース」を切替表示する UI モデル
 *     (活動 / ごほうび / チェックリスト。3 資源とも child 主軸 UI に統一、#3098 Sub-2)。
 *   - `'family-distribute'` — page top の配信 chip で複数 child に同時配信する旧 UI モデル
 *     (現在どの資源も採用していない。enum 値は将来の family-wide リソース用に温存)。
 *   - **重要**: organizingModel は **UI 表示軸**であり、データ scope とは別レイヤー (#3096)。
 *     activity/reward = per-child instance、checklist = family master template + assignments
 *     (ADR-0055 §3.1) とデータモデルは異なるが、UI は 3 資源とも `per-child-tabs` に揃える。
 *     checklist の per-child view は assignments で「選択中 child に配信済みの template」を絞るだけで、
 *     template 自体は tenant 1 レコードのまま (child ごとに重複作成しない)。
 * - `binding` — 取込 / 追加時に「どの子に紐付けるか」を確定する UI:
 *   - `'child-selection-dialog'` — ChildSelectionDialog で配信 / 取込先の子供を選ぶ
 *     (活動 / ごほうび = per-child instance 作成、チェックリスト = assignments 作成、#3098)。
 *   - `'visibility-chip'` — VisibilityChipGroup を page top の主軸入口にする旧モデル
 *     (現在どの資源も主軸には採用していない。checklist は配信先編集 dialog の二次導線で残す)。
 */
export type AdminResourceOrganizingModel = 'per-child-tabs' | 'family-distribute';
export type AdminResourceBinding = 'child-selection-dialog' | 'visibility-chip';

export interface AdminResourceModel {
	/** リソース種別キー (registry の key と一致) */
	readonly resource: 'activity' | 'reward' | 'checklist';
	/** ルート path (fitness function が goto する) */
	readonly route: string;
	/** リソース一覧をどう編成するか */
	readonly organizingModel: AdminResourceOrganizingModel;
	/** 取込 / 追加時の child 紐付け UI */
	readonly binding: AdminResourceBinding;
	/**
	 * DOM 整合検証用の代表 testid。
	 * - `childTabsTestid` — 子供タブ row (per-child-tabs では必須出現)。
	 * - `visibilityChipTestid` — family-distribute の配信先 chip (DOM 上に存在すべきか判定)。
	 *   per-child-tabs リソースでは null (配信 chip を持たない)。
	 */
	readonly childTabsTestid: string;
	readonly visibilityChipTestid: string | null;
}

/**
 * 正準スロット縦順 (#3096 SSOT)。各画面はこの順で「持つスロットだけ」埋める。
 * 順序・実装は不変。fitness function は各画面の DOM から「出現したスロットの testid」を上から順に
 * 抽出し、本配列の部分列 (subsequence) になっているか (= 正準順に並んでいるか) を assert する。
 *
 * slot index と意味:
 *   1 ヘッダー (AdminResourceHeader)
 *   2 子供タブ (常時 = 1 人以上)
 *   3 子供コンテキストバナー
 *   4 プラン系バナー (任意 — upgrade / limit)
 *   5 検索 + フィルタ行 (一覧の直上、検索必須)
 *   6 action message (role="status")
 *   7 一覧 (空時 UnifiedEmptyState)
 *   8 補助セクション (任意 — 一覧の下)
 */
export interface CanonicalSlot {
	readonly index: number;
	readonly name: string;
	/** この画面区分の代表 testid (画面ごとに prefix が異なるため、resource ごとに解決する) */
	readonly testid: (resource: AdminResourceModel['resource']) => string | null;
	/** 必須スロットか (header / child-tabs / search / list は全画面で必須) */
	readonly required: boolean;
}

/**
 * 各 resource の代表 testid を slot 単位で解決する。画面固有の prefix を吸収しつつ、
 * 「同じ slot は同じ役割の testid」を SSOT 化する。null = その resource はそのスロットを持たない。
 */
const SLOT_TESTIDS = {
	header: () => 'admin-resource-header',
	childTabs: (r: AdminResourceModel['resource']) =>
		r === 'activity'
			? 'admin-activities-child-tabs'
			: r === 'reward'
				? 'admin-rewards-child-tabs'
				: 'admin-checklists-child-tabs',
	childContextBanner: (r: AdminResourceModel['resource']) =>
		r === 'activity'
			? 'child-context-banner'
			: r === 'reward'
				? 'rewards-child-context-banner'
				: 'admin-checklists-child-context-banner',
	planBanner: (r: AdminResourceModel['resource']) =>
		r === 'activity'
			? 'admin-activities-plan-banner'
			: r === 'reward'
				? 'admin-rewards-plan-banner'
				: 'admin-checklists-plan-banner',
	search: (r: AdminResourceModel['resource']) =>
		r === 'activity'
			? 'admin-activities-search'
			: r === 'reward'
				? 'admin-rewards-search'
				: 'admin-checklists-search',
	actionMessage: (r: AdminResourceModel['resource']) =>
		r === 'activity'
			? 'admin-activities-action-message'
			: r === 'reward'
				? 'rewards-action-message'
				: 'checklists-action-message',
	list: (r: AdminResourceModel['resource']) =>
		r === 'activity'
			? 'admin-activities-list'
			: r === 'reward'
				? 'admin-rewards-list'
				: 'admin-checklists-list',
} as const;

export const CANONICAL_SLOT_ORDER: readonly CanonicalSlot[] = [
	{ index: 1, name: 'header', testid: SLOT_TESTIDS.header, required: true },
	{ index: 2, name: 'child-tabs', testid: SLOT_TESTIDS.childTabs, required: true },
	{
		index: 3,
		name: 'child-context-banner',
		testid: SLOT_TESTIDS.childContextBanner,
		required: false,
	},
	{ index: 4, name: 'plan-banner', testid: SLOT_TESTIDS.planBanner, required: false },
	{ index: 5, name: 'search', testid: SLOT_TESTIDS.search, required: true },
	{ index: 6, name: 'action-message', testid: SLOT_TESTIDS.actionMessage, required: false },
	{ index: 7, name: 'list', testid: SLOT_TESTIDS.list, required: true },
] as const;

/**
 * 必須スロット名 (header / child-tabs / search / list)。fitness function が「存在」を assert する。
 * action-message は条件付き表示 (操作後のみ) のため必須ではなく順序検証のみ対象。
 */
export const REQUIRED_SLOT_NAMES: readonly string[] = CANONICAL_SLOT_ORDER.filter(
	(s) => s.required,
).map((s) => s.name);

/**
 * child-binding モデル registry (SSOT)。
 *
 * activity / reward = per-child「子供が持つ」(per-child-tabs + child-selection-dialog)。
 * checklist = family master「配信される」(family-distribute + visibility-chip)。
 *   Sub-2 (#3096) で checklist を per-child-tabs に更新予定だが、本 PR では現状を宣言する。
 *
 * **ADR-0055 との関係 (Sub-1 暫定宣言)**: per-child / family master のデータモデル原則は ADR-0055 が
 * SSOT だが、ADR-0055 は設計 doc であり code-level の共有 type を持たない (本 registry 起票時点で
 * `organizingModel` / `binding` の TypeScript 型は本ファイルが初出)。よって本宣言は ADR-0055 の値を
 * **再宣言ではなく初の code 化**であり二重 SSOT ではない。将来 ADR-0055 由来の共有 scope 型
 * (`data-model-resource-scope`) が code 化された場合は、Sub-2 (#3096) で本 registry をそれに寄せて
 * 統一し、drift gate (registry 値 ⇄ schema/ADR 整合の CI 照合) を併設する。
 */
export const ADMIN_RESOURCE_MODEL_REGISTRY = {
	activity: {
		resource: 'activity',
		route: '/admin/activities',
		organizingModel: 'per-child-tabs',
		binding: 'child-selection-dialog',
		childTabsTestid: 'admin-activities-child-tabs',
		visibilityChipTestid: null,
	},
	reward: {
		resource: 'reward',
		route: '/admin/rewards',
		organizingModel: 'per-child-tabs',
		binding: 'child-selection-dialog',
		childTabsTestid: 'admin-rewards-child-tabs',
		visibilityChipTestid: null,
	},
	checklist: {
		resource: 'checklist',
		route: '/admin/checklists',
		// Sub-2 (#3098): UI 表示軸を child 主軸に統一 (activity / reward と同型)。
		//   子供タブで「選択中 child に配信済みの template だけ」を表示し (per-child view)、
		//   追加 / 取込は ChildSelectionDialog「どのお子さまに?」で配信先を選ぶ。
		//   data scope は family master template + assignments のまま (ADR-0055 §3.1 維持)。
		//   UI 統一とデータ scope は別レイヤー (#3096): activity/reward=per-child instance、
		//   checklist=family master+assignments だが、3 資源とも child 主軸 UI に揃える。
		//   VisibilityChipGroup は配信先編集 dialog (二次導線) に降格 — 主軸の入口ではないため
		//   visibilityChipTestid は null (page top に配信 chip を常設しない)。
		organizingModel: 'per-child-tabs',
		binding: 'child-selection-dialog',
		childTabsTestid: 'admin-checklists-child-tabs',
		visibilityChipTestid: null,
	},
} as const satisfies Record<string, AdminResourceModel>;

export type AdminResourceKey = keyof typeof ADMIN_RESOURCE_MODEL_REGISTRY;

/**
 * #3134: 正準スロット契約 (ADMIN_RESOURCE_MODEL_REGISTRY) の **scope 外**と判断した admin リソース
 * 管理画面と、その明示理由。
 *
 * 本 registry の正準契約は #3096 EPIC で導入した「marketplace 3 type (活動 / ごほうび / チェックリスト) の
 * per-child / family-master child-binding + 正準スロット縦順」を対象とする。以下の画面は admin リソース
 * 管理の見た目を持つが、この binding / 正準スロット契約には該当しないため registry には載せず、本リストで
 * **明示的に除外理由を記録**する。
 *
 * これにより `tests/unit/features/admin-resource-model-registry.test.ts` の no-silent-gap guard が
 * 「§10 admin リソース画面が registry にも本除外リストにも無い = 暗黙の網羅漏れ」を CI で検出できる
 * (#3131 監査 sev3-B: 契約が自身の網羅漏れを silent に見逃していた問題の構造的解消)。
 */
export const NON_CANONICAL_ADMIN_RESOURCES = {
	challenges: {
		route: '/admin/challenges',
		/**
		 * challenge-set は marketplace type (#2369、5 type の 1 つ) だが、#3195/#3227 で取込型から外れ、
		 * challenges 管理画面は ChildSelectionDialog 取込 binding (`?import=<presetId>` auto-open) も
		 * marketplace 取込 CTA も持たない **読み取り専用ビュー** (チャレンジはアプリが自動生成し、親は閲覧 +
		 * 削除のみ) に再構成済み。よって import binding 自体が非対象であり、加えてヘッダーが
		 * `AdminResourceHeader` ではなく inline で、正準スロット縦順 (search / list 等の testid 規約) にも
		 * 未移行のため、#3096 正準契約の scope 外。canonical 化 (AdminResourceHeader + 正準スロットへの移行)
		 * は #3096 系の大規模 UI refactor で別途判断する。本除外で「未移行の特例」として明示化する
		 * (silent drift にしない)。
		 */
		reason:
			'challenge-set は marketplace type (#2369) だが #3195/#3227 で取込型から外れ、admin/challenges は ChildSelectionDialog 取込 binding も取込 CTA も持たない読み取り専用ビュー (自動生成チャレンジの閲覧 + 削除のみ)。import binding 非対象に加え AdminResourceHeader + 正準スロット縦順にも未移行のため正準契約 scope 外。canonical 化は #3096 系の大規模 UI refactor で別途判断。',
	},
	rules: {
		route: '/admin/settings/rules',
		/**
		 * `/admin/settings/` 配下の settings サブページ (とくべつルール設定)。rule-preset (#2368) の marketplace
		 * 取込先ではあるが、per-child / family-master の resource-list 画面ではない (settings 内の一機能) ため、
		 * 正準スロット契約の対象外。
		 */
		reason:
			'settings サブページ (とくべつルール) で、rule-preset (#2368) marketplace 取込先だが resource-list ではない',
	},
} as const;

export type NonCanonicalAdminResourceKey = keyof typeof NON_CANONICAL_ADMIN_RESOURCES;

/**
 * DESIGN.md §10「admin リソース管理画面」の既知全集合 (#3134 no-silent-gap guard の母数)。
 * 各画面は **registry (正準契約) か NON_CANONICAL_ADMIN_RESOURCES (明示除外) のいずれかで必ず説明される**
 * こと。新規 admin リソース管理画面を追加したら本集合に加え、registry か除外リストに登録する
 * (どちらにも無いと unit test が fail する = 暗黙の網羅漏れを防ぐ)。
 */
export const ALL_ADMIN_RESOURCE_PAGES = [
	'activity',
	'reward',
	'checklist',
	'challenges',
	'rules',
] as const;

/**
 * #3164: `ALL_ADMIN_RESOURCE_PAGES` (手管理 literal) の網羅性を **実 route FS から導出**するための
 * 分類 SSOT。#3134 の no-silent-gap guard は 3 定数の整合は assert するが、母数自体が手管理 literal の
 * ため「真に新規の admin 画面を literal 未更新で追加すると silent pass」する blind spot があった
 * (#3134 root の部分達成、#3152 fitness function 機械強制の最初の具体適用先)。
 *
 * `tests/unit/features/admin-resource-model-registry.test.ts` が `src/routes/(parent)/admin/` 直下の
 * `+page.*` を持つ全 route dir を FS 走査し、各 dir が **resource page (key へ map) か non-resource page
 * (明示除外) のいずれか**で必ず説明されることを assert する。未分類の dir (= 新規 admin 画面の登録漏れ)
 * があれば fail する = 母数が SSOT (実 route FS) から導出される。
 */

/**
 * admin route path (admin/ からの相対、nested は '/' 区切り) → §10 正準契約の resource key への map。
 * resource-list 管理画面 (AdminResourceHeader / child-tabs を持つ §10 対象) のみを列挙する。
 * value は `ADMIN_RESOURCE_MODEL_REGISTRY` (正準) か `NON_CANONICAL_ADMIN_RESOURCES` (明示除外) の key。
 *
 * #3171: FS 走査を recursive 化したため、nested route の `settings/rules` (とくべつルール、rule-preset
 * marketplace 取込先) も母数に含まれるようになった。これを NON_CANONICAL の `rules` key に map し、
 * 「nested に新規 resource 管理画面を追加すると guard が検出せず silent-pass する」理論的 gap を封じる。
 */
export const ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY = {
	activities: 'activity',
	rewards: 'reward',
	checklists: 'checklist',
	challenges: 'challenges',
	// #3171: nested route。NON_CANONICAL_ADMIN_RESOURCES.rules (settings サブページの rule-preset) へ map。
	'settings/rules': 'rules',
} as const;

/**
 * admin route path (admin/ からの相対、nested は '/' 区切り) のうち、§10「admin リソース管理画面」
 * (resource-list) **ではない** page。FS 走査 (#3171 で recursive 化) の母数を全 admin page で説明する
 * ための明示除外 (silent gap を作らない)。新規に admin page を追加したら、resource-list なら
 * `ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY` + registry/除外へ、そうでなければ本リストへ reason 付きで登録する
 * (どちらにも無いと FS 走査 test が fail する)。
 *
 * #3171: recursive 化で nested route (settings サブページ / 詳細・編集ページ / 解約フロー等) も母数に
 * 含まれるため、それらも本リストで明示分類する。`[id]` は動的セグメントを literal で表す。
 */
export const NON_RESOURCE_ADMIN_PAGE_ROUTES = {
	// --- top-level non-resource ---
	billing: { reason: '課金・プラン管理画面 (resource-list ではない)' },
	certificates: { reason: '表彰状の発行・閲覧画面 (resource-list ではない)' },
	cheer: { reason: 'おうえんメッセージ送信画面 (resource-list ではない)' },
	children: { reason: 'お子さま登録・編集画面 (resource-list ではない)' },
	'growth-book': { reason: '成長記録 (グロースブック) 閲覧画面 (resource-list ではない)' },
	members: { reason: '家族メンバー管理画面 (resource-list ではない)' },
	packs: { reason: 'バックアップ/エクスポート (パック) 画面 (resource-list ではない)' },
	points: { reason: 'ポイント調整・履歴画面 (resource-list ではない)' },
	reports: { reason: 'レポート閲覧画面 (resource-list ではない)' },
	settings: { reason: '設定ハブ (サブページ集約)。配下の各サブページは個別に分類' },
	status: { reason: 'ステータス閲覧画面 (resource-list ではない)' },
	subscription: { reason: 'サブスクリプション管理画面 (resource-list ではない)' },
	// --- nested: 詳細・編集ページ (動的セグメント含む、#3171) ---
	'activities/[id]/edit': { reason: '活動の編集ページ (詳細フォーム、resource-list ではない)' },
	'certificates/[id]': { reason: '表彰状の個別表示ページ (詳細、resource-list ではない)' },
	'rewards/requests': {
		reason: 'ごほうび交換の承認待ち一覧 (redemption sub-page、resource-list ではない)',
	},
	// --- nested: 解約フロー (#3171) ---
	'billing/cancel': { reason: '解約フローの導入ページ (resource-list ではない)' },
	'billing/cancel/graduation': { reason: '解約フロー (卒業) ページ (resource-list ではない)' },
	'billing/cancel/thanks': { reason: '解約フロー (完了) ページ (resource-list ではない)' },
	// --- nested: settings サブページ (#3171。rules は ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY で resource 扱い) ---
	'settings/account': { reason: '設定 > アカウント (OYAKAGI / PIN、resource-list ではない)' },
	'settings/activities': { reason: '設定 > 活動 (ステータス減少設定、resource-list ではない)' },
	'settings/data': { reason: '設定 > データ (エクスポート/復元、resource-list ではない)' },
	'settings/notifications': { reason: '設定 > 通知 (resource-list ではない)' },
	'settings/support': { reason: '設定 > サポート (フィードバック、resource-list ではない)' },
} as const;

/**
 * admin 直下の route dir 1 件を分類する純関数 (#3164)。FS 走査 test が各 dir に対して呼ぶ。
 * - `'resource'` — §10 resource-list 管理画面 (`ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY` に存在)
 * - `'non-resource'` — resource-list ではない admin page (`NON_RESOURCE_ADMIN_PAGE_ROUTES` に存在)
 * - `'unclassified'` — どちらにも無い = 新規画面の登録漏れ (guard が fail させる対象)
 */
export function classifyAdminPageRoute(
	routeDir: string,
): 'resource' | 'non-resource' | 'unclassified' {
	if (routeDir in ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY) return 'resource';
	if (routeDir in NON_RESOURCE_ADMIN_PAGE_ROUTES) return 'non-resource';
	return 'unclassified';
}

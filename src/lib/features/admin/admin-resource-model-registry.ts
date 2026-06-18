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
 *   - `'per-child-tabs'` — リソースが per-child instance で、子供タブで「この子のリソース」を切替表示する
 *     (活動 / ごほうび。ADR-0055 per-child 主軸)。
 *   - `'family-distribute'` — リソースが family master で、配信先の子供を選んで複数の子に配る
 *     (チェックリスト。family master データモデル)。Sub-2 (#3096) で per-child-tabs へ寄せる予定。
 * - `binding` — 取込 / 追加時に「どの子に紐付けるか」を確定する UI:
 *   - `'child-selection-dialog'` — ChildSelectionDialog で取込先の子供を選ぶ (per-child リソース)。
 *   - `'visibility-chip'` — VisibilityChipGroup で配信先の子供を ON/OFF する (family master リソース)。
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
		organizingModel: 'family-distribute',
		binding: 'visibility-chip',
		childTabsTestid: 'admin-checklists-child-tabs',
		visibilityChipTestid: 'checklist-distribution-visibility',
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
		 * challenge-set は marketplace type (#2369、5 type の 1 つ) で、challenges 管理画面も per-child-tabs
		 * + ChildSelectionDialog 取込 binding (`?import=<presetId>` auto-open) を実装済み。よって binding /
		 * marketplace 自体は備えているが、ヘッダーが `AdminResourceHeader` ではなく inline `<h2>` で、正準
		 * スロット縦順 (search / list 等の testid 規約) にも未移行のため、現時点では #3096 正準契約の scope 外。
		 * canonical 化 (AdminResourceHeader + 正準スロットへの移行) は #3096 系の大規模 UI refactor で別途判断
		 * する。本除外で「未移行の特例」として明示化する (silent drift にしない)。
		 */
		reason:
			'challenge-set は marketplace type (#2369) で per-child-tabs + ChildSelectionDialog 取込 binding を持つが、AdminResourceHeader + 正準スロット縦順に未移行のため現時点で正準契約 scope 外。canonical 化は #3096 系の大規模 UI refactor で別途判断。',
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

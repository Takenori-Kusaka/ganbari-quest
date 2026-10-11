// labels 層 (ADR-0045 / #4965): みんなのテンプレート (marketplace) と取込 UI (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
import {
	ADMIN_VIEW_TERMS,
	BACKUP_TERMS,
	CHILD_SELECTION_TERMS,
	CHILD_TERMS,
	DEMO_SITE_TERMS,
	LOGIN_TERMS,
	TEMPLATE_TERMS,
	VISIBILITY_CHIP_TERMS,
} from '../terms';
import { NAV_ITEM_LABELS } from './nav';

// ============================================================
// テンプレート関連ラベル（#1174 ADR-0037 SSOT 化 / #1212-H ADR-0041 呼称変更）
// ============================================================

/**
 * テンプレート (`src/routes/marketplace/**`) の UI 文言 SSOT。
 * ADR-0041 により旧称「マーケットプレイス」→「みんなのテンプレート」/「テンプレート」へ移行。
 * URL は `/marketplace` のまま維持（内部技術用語 / ADR-0001 後方互換）。
 *
 * 既存の `MARKETPLACE_TYPE_LABELS` (`src/lib/domain/marketplace-item.ts`) は
 * アイテム種別（activity-pack / reward-set / 等）のみを扱うため、
 * それ以外のページ内テキストをここに集約する。
 *
 * LP (`site/`) で同語を扱う場合は `site/shared-labels.js` 経由で同期すること。
 */
export const MARKETPLACE_LABELS = {
	pageTitle: TEMPLATE_TERMS.userFacing,
	navShort: TEMPLATE_TERMS.short,
	pageDescription: 'お子さまの年齢にぴったりの活動・ごほうび・チェックリストを見つけよう',
	// Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由
	// #4511: 陳列は #2896 で 3 type (rule-preset はブラウズ不可)。検索流入者に 4 type を訴求しない
	metaDescription: `${TEMPLATE_TERMS.userFacing} — 活動・ごほうび・チェックリストを探そう。がんばりクエストの公式${TEMPLATE_TERMS.short}集です。`,
	filterClear: 'フィルタをクリア',
	emptyState: '条件に合うコンテンツがありません',
	// #4512: 詳細ルートの 404 文言 (旧: [type]/[itemId]/+page.server.ts 直書き)
	errorInvalidType: 'コンテンツタイプが不正です',
	errorItemNotFound: 'コンテンツが見つかりません',
	ctaHeading: `${TEMPLATE_TERMS.short}を使うには`,
	ctaSubheading: `アカウント登録後、${ADMIN_VIEW_TERMS.canonical}からワンタップで使ってみることができます`,
	ctaStart: '無料で はじめる',
	backToHome: 'トップページへ',
	backToDemo: 'デモを体験',
	// #4511: 旧 href="/demo" は legacy redirect → 「/」→ 未認証は /auth/login に落ちる
	// 死に導線だった (デモは #2181 で demo.ganbari-quest.com へ移設済み)。URL は atom 参照。
	// #4677 は「/demo 行きで死んでいる」ことを理由にリンク自体を撤去したが、本 atom で
	// 実在するデモ環境を指すようになったためリンクを残す (#4677 の禁止対象は href="/demo")
	backToDemoHref: DEMO_SITE_TERMS.url,
	// #2900: 認証済みの親が marketplace を開いた際の header 戻り導線
	// (AdminLayout の「← 子供画面へ」と同型。ADR-0045 atom 経由で SSOT 統一)
	backToAdmin: `← ${ADMIN_VIEW_TERMS.short}へ`,
	breadcrumbRoot: TEMPLATE_TERMS.short,
	// Round 18 Cluster A (ADR-0045): おすすめパック → TEMPLATE_TERMS atom 経由
	recommendedSection: `おすすめ${TEMPLATE_TERMS.short}`,
	questsBadge: 'クエスト集',
	detailIncludedActivities: 'ふくまれる活動',
	detailIncludedRewards: 'ふくまれるごほうび',
	detailChecklistItems: 'チェック項目',
	detailRuleContent: 'ルール内容',
	// #3227: challenge-set 詳細見出し / プレビュー label (detailIncludedChallenges /
	// detailChallengePeriod / detailChallengeMeta) は marketplace 詳細の isChallengeSet 到達不能
	// 分岐除去に伴い参照ゼロの dead label となったため削除。
	// #2558 bug-3: detailLegacyPackNote / detailLegacyPackLink / detailLegacyPackSuffix
	// は参照ゼロの dead label (内部語彙「パック」露出元) のため削除。marketplace 取込の
	// ユーザー向けラベルは TEMPLATE_TERMS (みんなのテンプレート / テンプレート) に統一。
	detailRulePointCost: '必要ポイント',
	detailRulePointBonus: 'ボーナス',
	detailCtaSignup: 'がんばりクエストに登録して使ってみる',
	// #4711: 取込 CTA 文言を取込 4 type (activity-pack / reward-set / checklist / rule-preset) で
	// 統一する。旧実装は type ごとに 4 様 (「ご家族の見守り画面で取り込む (N件を選択中)」/
	// 「🎁 このごほうびセットを一括追加 (N件)」/「一括追加」/「📜 このルールセットを一括追加 (N件)」)
	// で、一覧の type 名 (とくべつルール) と不一致な「ルールセット」も混ざっていた。
	/** 認証済 + 子供登録済: 件数付き統一 CTA */
	detailCtaImportUnified: (count: number) => `この${TEMPLATE_TERMS.short}を取り込む (${count}件)`,
	/** 未ログイン: login へ誘導する統一 CTA */
	detailCtaImportUnifiedSignedOut: `${LOGIN_TERMS.canonical}して${TEMPLATE_TERMS.short}を取り込む`,
	// #2362 PR-3 Phase 5: activity-pack 取込 CTA (CWE-598: marketplace 側で childId を扱わずご家族の見守り画面に delegate)
	/** activity-pack ログイン済 + 子供未登録 */
	detailCtaImportActivityPackNoChildren: 'まずはお子さまを登録してください',
	/** activity-pack 未ログイン CTA 説明 (誤新規登録防止) */
	detailCtaImportActivityPackSignedOut:
		'ログイン後、ご家族の見守り画面でお子さまを選んで取り込みます',
	/** activity-pack 説明 */
	detailCtaImportActivityPackDesc:
		'取り込む際はご家族の見守り画面で「どのお子さまに追加するか」を選びます',
	// Round 18 Cluster H (#13/#16/#20/#25/#28): activity-pack subset 選択 UI 用 labels
	/** Cluster H: subset 選択セクション見出し */
	detailActivityPackSelectHeading: '取り込む活動を選ぶ',
	/** Cluster H: 選択ヒント (preschool 親「30 件は多すぎる」「歯磨きとお片付けだけ欲しい」への直接回答) */
	// #4711: 「登録済み」判定は家族全体 (全員の活動名) なので、その旨を明記する。取込先の
	// お子さまに同名の活動があれば admin 側 (child 単位 dedup) でスキップされるため既定は全選択。
	detailActivityPackSelectHint:
		'チェックを外すと取り込みません。「ご家族のどなたかに登録済み」の活動も、取り込むお子さまにまだ無ければ追加されます（同じ名前の活動があるお子さまにはスキップされます）。',
	/** Cluster H: 既存活動と name 一致した場合のバッジラベル (family 全体判定) */
	detailActivityPackAlreadyExistsBadge: 'ご家族のどなたかに登録済み',
	/** Cluster H: 全て選択ボタン */
	detailActivityPackSelectAll: 'すべて選ぶ',
	/** Cluster H: 全て解除ボタン */
	detailActivityPackDeselectAll: 'すべて外す',
	/** Cluster H: 選択件数表示 (例: 「12件 / 30件 を取り込みます」) */
	detailActivityPackSelectedCount: (selected: number, total: number) =>
		`${selected}件 / ${total}件 を取り込みます`,
	/** Cluster H: 0 件選択時の inert 状態説明 */
	detailActivityPackSelectedZero: '取り込む活動を 1 件以上選んでください',
	/** #2136 MP-1: ログイン後の reward 取込誘導 */
	detailCtaImportRewardSignedOut: '一括追加するには登録 / ログインが必要です',
	/** #2136 MP-1: 取込先の子供選択ラベル */
	detailCtaSelectChild: 'お子さまを選択',
	/** #2136 MP-1: 重複ありの preview 文言 */
	detailRewardImportPreview: (newCount: number, dup: number) =>
		dup > 0
			? `新規 ${newCount} 件 / 重複 ${dup} 件（重複はスキップされます）`
			: `${newCount} 件のごほうびを追加します`,
	/** #2136 MP-1: 取込完了メッセージ */
	detailRewardImportSuccess: (count: number) => `✨ ${count} 件のごほうびを追加しました`,
	/** #2136 MP-1: 取込時に全件重複 */
	detailRewardImportAllDuplicates: 'このごほうびセットは既に追加済みです',
	/** #2136 MP-1: お子さま未登録時の誘導 */
	detailRewardImportNoChildren: 'まずはお子さまを登録してください',
	/** #2362 PR-4 (ADR-0055 / CWE-598): marketplace 取込ボタン下のヒント (admin 側でダイアログ) */
	detailRewardImportPerChildHint:
		'取り込む際はご家族の見守り画面で「どのお子さまに追加するか」を選びます',
	// #2137 (MP-2): event-checklist 取込 CTA 説明 (CTA 本体は detailCtaImportUnified、#4711)
	// #4657 F10: 取込先の呼称は現称「チェックリスト」(旧「持ち物リスト」は #2909 で撤去済の旧称)
	detailCtaImportChecklistDesc: `お子さまの「${NAV_ITEM_LABELS.checklists}」へまとめて追加します（重複時はスキップ）`,
	detailChildSelectLabel: 'どのお子さまに追加しますか？',
	detailImportSuccess: (n: number) => `${n}件のチェック項目を追加しました`,
	detailImportDuplicate: (templateName: string) =>
		`「${templateName}」は既に取込済みのためスキップしました`,
	detailImportError: 'インポートに失敗しました',
	// #2138 (MP-3): rule-preset 取込 CTA 説明 (CTA 本体は detailCtaImportUnified、#4711)
	detailCtaImportRuleDescBonus:
		'ご家族の見守り画面の「ルール」セクションに追加されます（取込後 ON/OFF できます）',
	detailCtaImportRuleDescExchange:
		'お子さまの「ごほうび」一覧にポイント交換アイテムとして追加されます',
	// #4511 / #4711: ADR 番号や no-op / penalty / special は社内語彙。顧客には
	// 「今は使えない」という事実だけを伝える (内部語を出さない #4711 の契約も満たす)
	detailCtaImportRuleDescPenalty:
		'⚠️ このタイプのルールは現在ご利用いただけません（お子さまへの罰を伴う仕組みは提供しない方針のため）。',
	detailCtaImportRuleDescSpecial:
		'⚠️ このタイプのルールは準備中です。追加しても、今はまだ画面には反映されません。',
	detailRuleImportSuccessBonus: (presetName: string) =>
		`✨ 「${presetName}」を追加しました。ご家族の見守り画面の「ルール」で ON/OFF できます。`,
	detailRuleImportSuccessExchange: (presetName: string, count: number) =>
		`✨ 「${presetName}」: ${count} 件のポイント交換アイテムを追加しました`,
	detailRuleImportDuplicate: (presetName: string) => `⚠️ 「${presetName}」は既に取込済みです`,
	detailRuleImportWarning: (msg: string) => `⚠️ ${msg}`,
	detailRuleImportNoChildrenExchange: 'まずはお子さまを登録してください',
	detailCtaImportRuleSignedOut: '一括追加するには登録 / ログインが必要です',
	detailRuleImportLinkToBonusList: '取込済ルール一覧へ →',
	detailRuleImportLinkToRewardsList: 'ごほうび一覧へ →',
	backToTypeListSuffix: '一覧に戻る',
	typeCountSuffix: '種',
} as const;

// ============================================================
// マーケットプレイス フィルタラベル（#1171 SSOT）
// ============================================================

/**
 * マーケットプレイスのフィルタ UI で使うラベルの SSOT。
 * #1171: フィルタ UI 刷新（年齢ラベル統一 / 性別 / 並び替え / モバイル bottom sheet）。
 * `src/routes/marketplace/+page.svelte` からハードコードを排除する。
 */
export const MARKETPLACE_FILTER_LABELS = {
	sectionTitle: 'しぼりこむ',
	age: '年齢',
	gender: '性別',
	tag: 'タグ',
	type: '種類',
	sort: 'ならべかえ',
	resultCount: (n: number) => `${n}件`,
	reset: 'フィルタをクリア',
	open: 'フィルタ',
	close: 'とじる',
	apply: 'この条件で探す',
	empty: '条件に合うコンテンツがありません',
	genderOptions: {
		all: 'すべて',
		boy: '男の子向け',
		girl: '女の子向け',
		neutral: 'どちらも',
	},
	sortOptions: {
		popularity: '人気順',
		newest: '新着順',
		ageFit: '年齢順',
	},
	// Round 18 Cluster C: 年齢 filter 既定 ON 化 (selectedChildId 経由) 時の hint + 解除動線
	// #4711: 名前 (nickname、「さくらちゃん」等の呼び名を含む) があるときは敬称を重ねない。
	autoAgeFilterApplied: (childName: string, ageTierLabel: string) =>
		childName
			? `${childName} (${ageTierLabel}) に合わせて表示中`
			: `${CHILD_TERMS.honorific} (${ageTierLabel}) に合わせて表示中`,
	clearAgeFilter: 'すべての年齢を表示',
	// Round 18 Cluster I (#11/#15/#19): 50+ 件 tag 並列が認知負荷過多のため、人気 N 件 default + expansion
	// Hick's Law (DESIGN.md §10) + ADR-0012 (Anti-engagement、user 意図的操作のみで展開) 整合
	expandTags: (remainingCount: number) => `もっと見る (残 ${remainingCount} 件)`,
	collapseTags: 'タグをたたむ',
} as const;

export type MarketplaceGender = 'boy' | 'girl' | 'neutral';
export type MarketplaceSortKey = keyof typeof MARKETPLACE_FILTER_LABELS.sortOptions;

/**
 * marketplace 取込 feedback の type 横断共通 compound (#2955)
 *
 * partial-failure (一部保存失敗) の表示文言は 5 type (activities / rewards / checklists /
 * challenges / rules) で同一にする (DESIGN.md §10 NN/G #4 consistency)。
 * 各 admin page は `resolveImportFeedback()` ($lib/marketplace/ui/import-feedback) 経由で
 * 本 compound を既定参照する。
 */
export const MARKETPLACE_IMPORT_FEEDBACK_LABELS = {
	// #2818: 一部 (または全件) が保存できなかったとき正直に出す。
	//   「N 件登録しました」と偽らず、追加できた件数と保存できなかった件数を分けて表示する。
	partialFailure: (imported: number, failed: number) =>
		imported > 0
			? `${imported} 件を追加しましたが、${failed} 件は保存できませんでした`
			: '保存に失敗しました。もう一度お試しください',
	// #4693: プラン上限で一部だけ入ったときに「入った件数」と「外した理由」を並べる。
	//   片方だけ出すと、顧客は「全部入った」か「何も入らなかった」のどちらかに誤解する。
	blockedAfterImport: (successText: string, reason: string) => `${successText}。${reason}`,
} as const;

// ============================================================
// ChildSelectionDialog (EPIC #2362 PR-2) — per-child 取込ダイアログ表示文字列
// ============================================================
//
// per-child 採用 type (activity / reward / challenge) の marketplace 取込時の
// 「誰に追加するか / 全員に追加するか」を選択させる Dialog の compound。
// terms.ts CHILD_SELECTION_TERMS + CHILD_TERMS atom を組み合わせる。

export const CHILD_SELECTION_LABELS = {
	dialogTitle: `${CHILD_SELECTION_TERMS.dialogTitleQuestion}${CHILD_TERMS.honorific}${CHILD_SELECTION_TERMS.dialogTitleSuffix}`,
	allOption: `${CHILD_SELECTION_TERMS.allOptionLabel}`,
	confirm: `${CHILD_SELECTION_TERMS.confirmLabel}`,
	confirmLoading: `${CHILD_SELECTION_TERMS.confirmLoadingLabel}`,
	cancel: `${CHILD_SELECTION_TERMS.cancelLabel}`,
	listAriaLabel: `${CHILD_SELECTION_TERMS.listAriaLabel}`,
	ageUnitSuffix: `${CHILD_SELECTION_TERMS.ageUnitSuffix}`,
} as const;

// ============================================================
// VisibilityChipGroup (EPIC #2362 PR-2) — family master per-child visibility 表示文字列
// ============================================================
//
// family master 採用 type (checklist / rule bonus) の edit modal 内の
// per-child visibility chip toggle compound。
// terms.ts VISIBILITY_CHIP_TERMS atom を template literal で参照。

export const VISIBILITY_CHIP_LABELS = {
	sectionTitle: `${VISIBILITY_CHIP_TERMS.sectionTitle}`,
	toggleOn: `${VISIBILITY_CHIP_TERMS.toggleOn}`,
	toggleOff: `${VISIBILITY_CHIP_TERMS.toggleOff}`,
	allOn: `${VISIBILITY_CHIP_TERMS.allOnLabel}`,
	allOff: `${VISIBILITY_CHIP_TERMS.allOffLabel}`,
	groupAriaLabel: `${VISIBILITY_CHIP_TERMS.groupAriaLabel}`,
} as const;

// ============================================================
// #2370 (EPIC #2362 P4): UnifiedImportHub + UnifiedEmptyState ラベル
//
// PO 指摘 ② (admin import UX が type ごとに分散) 直接解決のため、
// 5 type 横断で再利用される UI ラベルを集約する SSOT。
//
// 参照箇所:
//   - src/lib/marketplace/ui/UnifiedImportHub.svelte (5 type 共通 import エントリ)
//   - src/lib/marketplace/ui/UnifiedEmptyState.svelte (5 admin リソース共通 empty state)
//   - src/routes/(parent)/admin/{activities,rewards,checklists,settings/rules,challenges}/
//
// 設計原則 (DESIGN.md §10 Hick's Law / EPIC #2253 bridge ルール):
//   - empty state は「ないなら追加」へ secondary link を提供（initial setup 期の発見性）
//   - header `+` メニュー内 1 階層内アクセスで運用期の到達性を確保
//   - import / 手動作成の 2 経路を統一的に表示し add 経路 ≤ 4 を維持
// ============================================================
export const UNIFIED_IMPORT_HUB_LABELS = {
	heading: 'まとめて取り込む',
	description: 'マーケットプレイスや手元のファイルから一括で追加できます。',
	loading: '処理中...',
	emptyMarketplace: '取り込めるアイテムが見つかりません。',
	marketplaceHeading: 'マーケットプレイスから',
	fileHeading: 'ファイルから',
	// #backup-terms: 活動取込は CSV (自作表計算) も受けるため CSV を露出する (ADR-0013 truth)
	// #3201: slash 表記「バックアップ / CSV」を廃止し 2 つの入力源を平易に並記
	fileDesc: `保存しておいた${BACKUP_TERMS.file}か、表計算ソフトで作った${BACKUP_TERMS.csvFile}を取り込みます。`,
	fileImportBtn: 'ファイルを取り込む',
	// #4716 item 15: 取込結果メッセージで pack 名が返らなかったときの代替表記。
	fallbackImportedName: '取り込んだファイル',
	addBtn: 'この内容で追加',
	processingText: '取り込み中...',
	// 5 type 共通の type 切替タブ
	typeTabAriaLabel: '取り込む種類を選ぶ',
	// 結果メッセージ (type 横断、imported/skipped を含む)
	resultSuccess: (name: string, imported: number, skipped: number) =>
		skipped > 0
			? `「${name}」を取り込みました（追加 ${imported} 件 / スキップ ${skipped} 件）`
			: `「${name}」を取り込みました（追加 ${imported} 件）`,
	resultAllDuplicates: (name: string) => `「${name}」はすべて重複していました（追加 0 件）`,
	resultError: '取り込みに失敗しました',
	// #2558 bug-1: デモ環境では書き込みが no-op 化されるため、成功偽装ではなく
	// 「お試し用」であることを明示して dialog を閉じる (dead-end 解消)。
	resultDemo: 'デモではお試し用です（実際の追加は行われません）',
	// Pack / set 説明 (type 表示用)
	itemCountSuffix: (count: number) => `（${count} 件）`,
	targetAgeRange: (min: number, max: number) => `対象年齢 ${min} 〜 ${max} 歳`,
	// childId 未選択時の警告 (reward-set / checklist 等 requiresChildId === true で表示)
	childRequiredHint: `※ 対象の${CHILD_TERMS.honorific}を選んでから取り込みできます。`,
	// preset 内アイテム数と対象年齢の連結 separator
	itemAgeSeparator: '・',
	// 既に取込済みの preset に表示するバッジ (#2391 Phase 2/3)
	importedBadge: '取込済み',
	// type 選択時のヒント
	typeHintActivityPack: 'プリセット活動を一括で追加します。',
	typeHintRewardSet: `ごほうびテンプレートを${CHILD_TERMS.honorific}ごとに一括登録します。`,
	typeHintChecklist: '持ち物チェックリストのテンプレートを取り込みます。',
	typeHintRulePreset: 'ポイント交換や連続ボーナス等のルールを取り込みます。',
	typeHintChallengeSet: '家族で取り組むチャレンジ集を一括で追加します。',
} as const;

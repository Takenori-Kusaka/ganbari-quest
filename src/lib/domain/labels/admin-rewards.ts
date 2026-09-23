// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/rewards。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS, adminScreenHeading } from '../admin-screens';
import {
	REWARD_REJECT_NOTE_MAX_LENGTH,
	REWARD_REQUEST_HISTORY_LIMIT,
} from '../constants/redemption-status';
import {
	ADD_MENU_TERMS,
	CHEER_TERMS,
	CHILD_TERMS,
	CONCEPT_ICONS,
	PLAN_FULL_TERMS,
	REWARD_ADMIN_TERMS,
	REWARD_TERMS,
} from '../terms';
import { COPY_FROM_CHILD_LABELS } from './admin-shared';

// #4676: PAGE_GUIDE_LABELS.adminRewardsRequests がボタン名・見出しを参照するため前置きする
export const ADMIN_REWARDS_REQUESTS_LABELS = {
	// #4716: 他の admin title に絵文字が無いため揃える (title は絵文字なし / 画面内見出しに絵文字)
	pageTitle: 'ごほうび申請承認',
	pageDescTitle: `${CONCEPT_ICONS.reward} ごほうび申請承認`,
	// #4676 F5: 保護者向け画面のため CHILD_TERMS.honorific に統一し、英語見出しを日本語にする
	pageDescText: `${CHILD_TERMS.honorific}からの交換申請を承認 / 却下します。`,
	backToRewardsLabel: `← ${ADMIN_SCREENS.rewards.name}に戻る`,
	// #4716: 英語の節見出し (Pending / History) を日本語に
	pendingSectionTitle: '承認待ち',
	pendingCountSuffix: (count: number) => `${count} 件`,
	// #4682 F1: 承認待ちが表示上限を超えたとき、「見えている件数 = 全件」と誤解させない。
	// 表示は古い順なので、長く待っている申請から必ず画面に出る。
	pendingTruncatedNote: (shown: number, total: number) =>
		`古い順に ${shown} 件を表示しています（未処理の申請は全 ${total} 件）。処理すると次の申請が出ます`,
	// #4682 F4: 「直近 30 申請の中の処理済み」ではなく「処理済みの直近 30 件」を出す。
	// #4716: 節見出しは英語 (History) を廃し、何の一覧かが分かる日本語にする。
	historySectionTitle: `これまでの申請（直近${REWARD_REQUEST_HISTORY_LIMIT}件）`,
	emptyPendingMessage: '申請はありません',
	emptyHistoryMessage: '履歴はありません',
	approveButton: '承認して渡した',
	rejectButton: '却下する',
	rejectNoteLabel: `却下理由（任意・最大${REWARD_REJECT_NOTE_MAX_LENGTH}文字）`,
	rejectConfirmButton: '確定',
	rejectCancelButton: 'キャンセル',
	// #4716: 表示は日付のみ (時刻を出していない) ため「日時」を名乗らない
	requestedAtLabel: '申請日',
	rewardPointsUnit: 'ポイント',
	statusApproved: '承認済み',
	statusRejected: '却下済み',
	// #4682 F4: 履歴行に「いつ処理したか」「なぜ却下したか」を出す
	// (旧実装は申請日時も却下理由も出さず、親が後から判断を思い出せなかった)。
	resolvedAtLabel: '処理日時',
	rejectNoteHistoryLabel: '却下理由',
} as const;

// ============================================================
// ごほうびページ (#1452 Phase B)
// ============================================================

export const REWARDS_LABELS = {
	// #2268: CRUD 整備 + 命名訂正 + 検索 + grant→add リネーム
	// 応援系語彙（とくべつなごほうび / ボーナス贈与 / ボーナスポイントを贈れます）は削除済
	// #4656 F5: 呼称は ADMIN_SCREENS.rewards.name (ごほうび管理)、icon は CONCEPT_ICONS.reward。
	// #4715: 画面名の SSOT は ADMIN_SCREENS。adminScreenHeading が「アイコン + 画面名」を組む
	sectionTitle: adminScreenHeading('rewards'),
	// EPIC #3533: 旧 premiumBadge (ヘッダー「有料限定」バッジ) は §10.2 P3/P4 で撤去。
	tabRewards: 'ごほうび',
	// #2998 fix: pageDescTitle / pageDescText1 は AdminResourceHeader の title / description と
	// 二重表示になっていたため撤去。応援機能との区別案内 (pageDescText2) と messages クロスリンク
	// (pageDescHint*) のみ page-description カードに残す。
	// #4656 F8 / M1 + #4716: 生 URL 露出と旧 /admin/messages 参照をやめ、応援ページへの link に統一
	// (#4654 B15 の「旧 /admin/messages 参照をやめる」意図も本文言で満たす)。画面名は #4715 の
	// registry (ADMIN_SCREENS.cheer.name) から引き、下の pageDescHintLink と同じ語にする。
	// #4654 (B15): 旧「おうえんメッセージ」(/admin/messages) は #2270 で応援画面に統合済。
	pageDescText2: `その場でひと押ししたい${CHEER_TERMS.canonical}（突発のごほうび）は${ADMIN_SCREENS.cheer.name}ページから送れます。`,
	pageDescHintPrefix: '💌 スタンプやメッセージは',
	// #4715: 着地先は /admin/cheer。旧「おうえんメッセージ」は同画面の別名で、
	//   リンク先も旧 URL /admin/messages (308 redirect) を指していた。
	pageDescHintLink: ADMIN_SCREENS.cheer.name,
	pageDescHintSuffix: 'から送れます',
	// EPIC #3533: 旧 free 向けアップグレード誘導バナー文言 (upgradeBannerTitle/Desc/Button) は
	//   §10.2 P1/P3 で撤去 (画面内 CTA バナーを廃止、制約詳細はプラン画面へ一元化)。
	selectChildTitle: `${CHILD_TERMS.honorific}を選択`,
	selectTemplateTitle: 'プリセットを選択',
	presetToggle: (open: boolean) => `${open ? '▼' : '▶'} プリセットから追加`,
	// #2268: 検索 UI
	searchLabel: REWARD_ADMIN_TERMS.search,
	searchPlaceholder: 'ごほうび名で検索...',
	searchEmptyMessage: '該当するごほうびがありません',
	confirmGrantTitle: '内容を確認して追加',
	titleLabel: REWARD_ADMIN_TERMS.formTitle,
	pointsLabel: REWARD_ADMIN_TERMS.formPoints,
	iconLabel: REWARD_ADMIN_TERMS.formIcon,
	categoryLabel: 'カテゴリ',
	// #2268: grant → add リネーム（実態は special_rewards INSERT、子供 shop に並べる商品の追加）
	grantButton: (icon: string, title: string, points: number) =>
		`${icon} ${title || REWARD_TERMS.canonical} (${points}P)${REWARD_ADMIN_TERMS.submitSuffix}`,
	grantSuccess: 'ごほうびを追加しました！',
	// #2268: overflow menu / 申請承認導線（子#3 で /admin/rewards/requests へ分離）
	overflowMenuAriaLabel: 'その他の操作',
	requestsMenuLabel: (count: number) => `${REWARD_ADMIN_TERMS.requestsMenu} (${count} 件)`,
	requestsMenuLabelEmpty: REWARD_ADMIN_TERMS.requestsMenu,
	/** #2136 MP-1: マーケットプレイス一括追加セクション */
	marketplaceSectionTitle: 'みんなのごほうびから追加',
	marketplaceSectionDesc: 'おすすめのごほうびセットを一括追加できます（重複はスキップ）',
	marketplaceImportButton: (count: number) => `${count} 件を一括追加`,
	marketplaceImportSuccess: (count: number) => `✨ ${count} 件のごほうびを追加しました`,
	marketplaceImportAllDuplicates: 'このごほうびセットは既に追加済みです',
	marketplaceImportError: 'インポートに失敗しました',
	marketplaceItemCountSuffix: '件',
	marketplaceImportToggle: (open: boolean) => `${open ? '▼' : '▶'} みんなのごほうびから追加`,
} as const;

/**
 * /admin/rewards (per-child UX 整備) 用ラベル (#2362 PR-4、ADR-0055)
 *
 * PR-3 の ADMIN_ACTIVITIES_PAGE_LABELS と同型 (子供別タブ + 兄弟共通化 + 取込ダイアログ)。
 * CHILD_TERMS atom を template literal で参照し ADR-0045 整合。
 */
export const ADMIN_REWARDS_PAGE_LABELS = {
	// 子供別タブ
	childTabsAriaLabel: `${CHILD_TERMS.honorific}を選択`,
	childCountSuffix: '件',
	// 兄弟共通化 actions
	// #4716: 活動 / チェックリストと同じ COPY_FROM_CHILD_LABELS を参照する
	//   (tests/unit/domain/parent-wording-hygiene-4716.test.ts が一致を assert する)
	copyFromChildButton: COPY_FROM_CHILD_LABELS.action,
	// 選択中 child banner
	childContextRewardsSuffix: (count: number) => `のごほうび (${count} 件)`,
	childContextHint: `タブを切り替えると、他の${CHILD_TERMS.honorific}のごほうびを表示します`,
	// copy dialog
	copyDialogTitle: COPY_FROM_CHILD_LABELS.dialogTitle('ごほうび'),
	copyDialogDescPrefix: 'コピー元の',
	copyDialogDescSuffix: 'を選んでください (コピー先: ',
	copyDialogDescCloseParen: ')',
	copyDialogSelectedPlaceholder: '—',
	copyDialogAgeSuffix: '歳',
	copyDialogCountSuffix: '件',
	copyDialogEmpty: `他の${CHILD_TERMS.honorific}がいません`,
	copyDialogCancel: 'キャンセル',
	copyDialogConfirm: 'コピーする',
	// 取込ダイアログ後の result toast
	importSuccess: (count: number) => `✨ ${count} 件のごほうびを追加しました`,
	importAllDuplicates: 'このごほうびセットは既に追加済みです',
	importFailed: '取込に失敗しました',
	// #2558 bug-1: デモ環境では書き込みが no-op 化される。成功偽装せず明示する。
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	copyFailed: 'コピーに失敗しました',
	copySameChild: `違う${CHILD_TERMS.honorific}を選んでください`,
	// 互換: importPresetId が無効な場合の guidance
	importInvalidPreset: '取込対象のプリセットが見つかりませんでした',
	// #2998 (EPIC #2897): ヘッダー + 「+ 追加」dropdown 統一 (activities / checklists と同型)。
	//   AI 提案パネル本文直置きを撤去し、dropdown 内の選択肢 (手動 / AI / みんなのテンプレートから探す)
	//   → Dialog 起動に統一する (DESIGN.md §10 add 経路 ≤ 4 / NN/G #4 consistency)。
	//   icon / 文言は activities header (FEATURES_LABELS.activitiesHeader.add*) と同一語彙で揃え、
	//   3 画面の add 経路構成 (種類・順序) 一致を E2E (admin-add-path-isomorphism.spec.ts) で固定する。
	// #4656 M2: 英語 'shop' 表記をやめ REWARD_TERMS.shop (ごほうびショップ) に統一
	// #4716: 保護者画面の子供呼称は CHILD_TERMS.honorific に統一
	headerDescription: `${CHILD_TERMS.honorific}の${REWARD_TERMS.shop}に並べるごほうび（おこづかい・ゲーム時間・おやつなど）を管理します`,
	addMenuButton: ADD_MENU_TERMS.trigger,
	addMenuAriaLabel: 'ごほうびを追加するメニューを開く',
	addManualLabel: ADD_MENU_TERMS.manual,
	addManualIcon: '✏️',
	addAiLabel: ADD_MENU_TERMS.ai,
	addAiIcon: '✨',
	addBrowseTemplatesLabel: ADD_MENU_TERMS.browse,
	addBrowseTemplatesIcon: '🔍',
	// add dialog title (mode 別、activities の addDialogTitle* / checklists の addDialogTitleAi と同型)
	addDialogTitleManual: '+ 手動でごほうびを追加',
	addDialogTitleAi: 'AI で提案してもらう',
	// #2832: reward 一覧の編集 / 削除 (pending redemption ガード)
	rewardListEmpty: `この${CHILD_TERMS.honorific}にはまだごほうびがありません`,
	rewardEditButton: REWARD_ADMIN_TERMS.edit,
	rewardDeleteButton: REWARD_ADMIN_TERMS.delete,
	rewardPendingBadge: REWARD_ADMIN_TERMS.pendingBadge,
	// #4992 (PO 決裁 Q2 の条件 2): 無料プランでは「編集」を押せない。その理由を**押す前に**読めるよう、
	// 一覧の上に常時出し、各行のロックした「編集」から aria-describedby で指す。
	// 拒否されてから初めて理由が出る形 (旧: 説明なしの disabled) にはしない。
	editLockedNote: `「${REWARD_ADMIN_TERMS.edit}」（${REWARD_ADMIN_TERMS.formTitle}や${REWARD_ADMIN_TERMS.formPoints}の変更）は${PLAN_FULL_TERMS.standard}以上の機能です。「${REWARD_ADMIN_TERMS.delete}」はどのプランでもできます`,
	editDialogTitle: 'ごほうびを編集',
	// AC2 (案 b): 編集許容 + snapshot 仕様 (申請時点値) の明示 note
	editPendingNote: '申請済みの交換は申請時点の内容（名前・ポイント）で処理されます',
	editSaveButton: '保存する',
	editSavingButton: '保存しています…',
	editCancelButton: 'キャンセル',
	editSuccess: 'ごほうびを更新しました',
	editFailed: '更新に失敗しました',
	deleteDialogTitle: 'ごほうびを削除',
	deleteConfirmMessage: (title: string) => `「${title}」を削除しますか？`,
	// #4683: 交換履歴は残す (ポイント台帳の控除が残る以上、履歴だけ消すと辻褄が合わない)。
	deleteIrreversibleNote:
		'この操作は取り消せません。交換ずみの履歴は残るので、使ったポイントはあとから確認できます。',
	deleteConfirmButton: '削除する',
	deleteDeletingButton: '削除しています…',
	deleteCancelButton: 'キャンセル',
	deleteSuccess: 'ごほうびを削除しました',
	deleteFailed: '削除に失敗しました',
	// AC1: pending redemption ガード (hasPendingByReward) の削除拒否メッセージ
	deletePendingBlocked:
		'交換申請が処理待ちのため削除できません。申請を承認または却下してから削除してください',
	// #3147: ショップ陳列系統 (physical/money/privilege) の登録時セレクト。
	// RewardCategory(6値) とは独立した「子供 shop の 3 タブ」のどれに並べるかの軸。
	// 未選択 (auto) のときは表示側 deriveShopCategory が title/icon から推定する。
	shopCategoryLabel: REWARD_ADMIN_TERMS.shopCategory,
	// #4716: 保護者画面の子供呼称は CHILD_TERMS.honorific に統一
	shopCategoryHint: `${CHILD_TERMS.honorific}の${REWARD_TERMS.shop}でどのタブに並べるかを選べます（未選択なら自動で振り分け）`,
	shopCategoryAuto: '自動で振り分け',
	shopCategoryPhysical: 'もの（おもちゃ・おやつなど）',
	shopCategoryMoney: 'おこづかい',
	shopCategoryPrivilege: 'とくべつ（ゲーム時間・おでかけなど）',
} as const;

// ============================================================
// ごほうびショップ 保護者の見守り画面 申請タブ (#1337 / #2057)
// ============================================================

export const ADMIN_SHOP_REQUEST_LABELS = {
	tabLabel: '申請',
	tabLabelRequests: 'ごほうび申請',
	emptyPendingMessage: '申請はありません',
	approveButton: '承認して渡した',
	rejectButton: '却下する',
	rejectNoteLabel: `却下理由（任意・最大${REWARD_REJECT_NOTE_MAX_LENGTH}文字）`,
	rejectConfirmButton: '確定',
	rejectCancelButton: 'キャンセル',
	requestedAtLabel: '申請日時',
	childNameLabel: '子供',
	rewardPointsUnit: 'ポイント',
	statusApproved: '承認済み',
	statusRejected: '却下済み',
	historyTabLabel: '履歴',
} as const;

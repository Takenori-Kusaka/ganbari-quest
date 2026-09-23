// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/checklists。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import {
	ADD_MENU_TERMS,
	BACKUP_TERMS,
	CHECKLIST_ADMIN_TERMS,
	CHILD_TERMS,
	CONCEPT_ICONS,
	OVERFLOW_MENU_TERMS,
	TEMPLATE_TERMS,
} from '../terms';
import { COPY_FROM_CHILD_LABELS } from './admin-shared';

export const ADMIN_CHECKLISTS_PAGE_LABELS = {
	// #3097 (EPIC #3096): 正準スロット契約に conform — 子供タブ / 子供コンテキストバナー / 検索を
	//   activities (ADMIN_ACTIVITIES_PAGE_LABELS) と同型に揃える (NN/G #4 consistency)。
	childTabsAriaLabel: `${CHILD_TERMS.honorific}を選択`,
	childContextSuffix: 'のチェックリスト',
	// #3098: child 主軸 UI 統一に伴い hint を activities (childContextHint) と同型に揃える。
	childContextHint: `タブを切り替えると、他の${CHILD_TERMS.honorific}のチェックリストを表示します`,
	searchLabel: CHECKLIST_ADMIN_TERMS.search,
	searchPlaceholder: 'チェックリスト名で検索...',
	// #1755 (#1709-A): kind 削除に伴い tabAriaLabel は本 sub では未使用化
	//   後続 sub-issue (#1709-B) で他用途に流用 / 削除を検討
	tabAriaLabel: 'チェックリスト種別',
	// #1755 (#1709-A): kind 削除 — emptyChecklistMessage に統合
	emptyKindSuffix: 'がまだありません',
	// #2899: title は汎用チェックリスト機能のため「持ち物」限定表記を外す
	emptyChecklistMessage: 'チェックリストがまだありません',
	// #1755 (#1709-A): kind 選択削除に伴うダイアログタイトル / プレースホルダ統合
	addTemplateDialogTitle: 'チェックリスト作成',
	namePlaceholderItem: '例: がっこうのもちもの',
	inactiveBadge: CHECKLIST_ADMIN_TERMS.inactiveBadge,
	deleteButton: CHECKLIST_ADMIN_TERMS.delete,
	// #4023 横展開 (#4512): native confirm() を Dialog primitive に置換 (DESIGN.md §5)。
	//   本文は admin/challenges の deleteConfirmBody と同型で「何が一緒に消えるか」を書く。
	//   deleteTemplate は assignments / items / logs を cascade 削除する
	//   (src/lib/server/db/sqlite/checklist-repo.ts deleteTemplate)。
	// #4716: 対象名だけでなく配信先 (どの子の画面から消えるか) も本文に出す。
	deleteConfirmTitle: 'このチェックリストを削除しますか？',
	deleteConfirmBody: (templateName: string, childNames: string) =>
		`「${templateName}」を削除します。${childNames}の画面から消え、ふくまれるアイテムと、これまでのチェック記録も一緒に消えます。この操作は取り消せません。`,
	deleteConfirmBodyNoChild: (templateName: string) =>
		`「${templateName}」を削除します。ふくまれるアイテムと、これまでのチェック記録も一緒に消えます。この操作は取り消せません。`,
	deleteConfirmAccept: '削除する',
	// #4716 item 15: 画面直書きだった顧客可視文言を SSOT へ
	frequencyDaily: 'まいにち',
	frequencyWeekday: (day: string) => `${day}よう`,
	directionBring: '持参',
	directionReturn: '持帰',
	directionBoth: '往復',
	timeSlotAnytime: 'いつでも',
	timeSlotMorning: 'あさ',
	timeSlotAfternoon: 'ひる',
	timeSlotEvening: 'よる',
	distributionSaveError: '配信先の保存に失敗しました',
	templateDeactivateAction: '無効にする',
	templateActivateAction: '有効にする',
	templateDeactivateButton: '無効化',
	templateActivateButton: '有効化',
	overrideActionAdd: '追加',
	overrideActionRemove: '除外',
	fieldNameLabel: '名前',
	fieldTimeSlotLabel: '時間帯',
	fieldFrequencyLabel: '頻度',
	fieldDirectionLabel: '方向',
	fieldDateLabel: '日付',
	fieldOverrideActionLabel: '操作',
	fieldItemNameLabel: 'アイテム名',
	itemNamePlaceholder: '例: ハンカチ',
	overrideItemNamePlaceholder: '例: リュック（遠足）',
	timeSlotLabel: CHECKLIST_ADMIN_TERMS.timeSlot,
	addItemButton: CHECKLIST_ADMIN_TERMS.addItem,
	// EPIC #3533: 旧 free 上限バナー文言 (limitReachedText / limitCountText / upgradeLink / upgradeDesc) は
	//   §10.2 P1/P3 に基づき撤去 (画面内 quota カウンタ・個別アップセル CTA を廃止、制約詳細はプラン画面へ一元化)。
	addTemplateButton: '+ テンプレート作成',
	addOverrideButton: `📅 ${CHECKLIST_ADMIN_TERMS.addOverride}`,
	// #2778 (Cluster D / User 指摘 #1 ボタン重複解消): 2 並列 button → 「+ 追加」dropdown menu 集約 (Hick's Law)
	addMenuButton: ADD_MENU_TERMS.trigger,
	// #2903 (EPIC #2897): add 経路を activities (ActivitiesHeader) と同型に統一。
	//   AI 提案パネル直置きを撤去し「+ 追加」dropdown 内の選択肢 (手動 / AI / テンプレから探す / ワンオフ) に格納する。
	//   icon / 文言は activities header の add menu (FEATURES_LABELS.activitiesHeader.add*) と同一語彙で揃え、
	//   両ページの add 経路構成 (種類・順序) が一致することを E2E で assert 可能にする (AC3 同型性固定)。
	addMenuAriaLabel: 'チェックリストを追加するメニューを開く',
	addManualLabel: ADD_MENU_TERMS.manual,
	addManualIcon: '✏️',
	addAiLabel: ADD_MENU_TERMS.ai,
	addAiIcon: '✨',
	addBrowseTemplatesLabel: ADD_MENU_TERMS.browse,
	addBrowseTemplatesIcon: '🔍',
	addOverrideMenuLabel: CHECKLIST_ADMIN_TERMS.addOverride,
	addOverrideMenuIcon: '📅',
	// add dialog title (mode 別、activities の addDialogTitle* と同型)
	addDialogTitleAi: 'AI で提案してもらう',
	todayOverrideTitle: `📅 ${CHECKLIST_ADMIN_TERMS.todayOverride}`,
	formKindLabel: '種別',
	formIconLabel: 'アイコン',
	createButton: '作成',
	addButton: '追加',
	addItemDialogTitle: 'アイテム追加',
	overrideDialogTitle: 'ワンオフ追加/除外',
	// EPIC #3533: 旧 premiumBadgeLabel (ヘッダー「スタンダード以上」バッジ) は §10.2 P3/P4 で撤去
	//   (tier 表示は header に一本化、画面内の個別プランバッジは非採用)。
	// #2137 (MP-2): マーケットプレイス checklist 一括追加セクション (#2272: UI ラベルは TEMPLATE_TERMS atom 経由)
	marketplaceSectionTitle: `${CONCEPT_ICONS.template} ${TEMPLATE_TERMS.userFacing}から一括追加`,
	marketplaceSectionDesc:
		'季節やイベント時のチェックリストをワンタップで取込めます（重複時はスキップ）',
	marketplaceItemCount: (n: number) => `${n}項目`,
	marketplaceImportButton: CHECKLIST_ADMIN_TERMS.marketplaceImportCta,
	marketplaceImportedBadge: '取込済',
	marketplaceImportSuccess: (presetName: string, items: number) =>
		`✅ 「${presetName}」: ${items}項目を追加しました`,
	marketplaceImportDuplicate: (presetName: string) =>
		`⚠️ 「${presetName}」は既に取込済みのためスキップしました`,
	// #4657 F2 (EPIC #4650 PO 判断): 同じ遷移先を指す 3 導線を「みんなのテンプレートから探す」に統一
	marketplaceSeeMore: `${ADD_MENU_TERMS.browse} →`,
	// #2362 PR-5 Phase 2: family master UX (ChecklistDistributionDialog / OverflowMenu / per-child progress)
	// #2899: 汎用チェックリスト機能のため「持ち物」限定表記を「チェックリスト / リスト」へ是正
	// #4715: 画面名は registry (nav / title / 見出しが同じ値になる)
	pageTitle: ADMIN_SCREENS.checklists.name,
	familyChecklistsSectionTitle: '家族のチェックリスト',
	// #3098: child 主軸 UI 統一に伴い、header 説明を「子供タブで選択中の子のチェックリストを表示」軸に更新。
	//   同じリストを複数のお子さまに配ることも可能 (= 追加時に配信先を選ぶ) という従来の柔軟性は維持。
	familyChecklistsSectionDesc:
		'お子さまタブで、その子のチェックリストを管理できます。同じリストを複数のお子さまに追加することもできます。',
	emptyFamilyMessage: '家族のチェックリストがまだありません',
	emptyFamilyDesc: `みんなのテンプレートから取込むか、「${OVERFLOW_MENU_TERMS.itemMarketplace}」メニューから追加できます`,
	browseMarketplaceLink: `${CONCEPT_ICONS.template} ${TEMPLATE_TERMS.browse} →`,
	distributionSectionTitle: CHECKLIST_ADMIN_TERMS.distributionSection,
	distributionEmpty: '誰にも配信されていません',
	distributionConfigureButton: CHECKLIST_ADMIN_TERMS.configureDistribution,
	distributionDialogTitle: '配信先のお子さまを選ぶ',
	distributionDialogDesc: 'チェックを入れたお子さまの画面に、このチェックリストが表示されます。',
	distributionSaveButton: '配信先を保存',
	distributionUpdated: (added: number, removed: number) =>
		`配信先を更新しました（追加 ${added} 件 / 解除 ${removed} 件）`,
	distributionNoChange: '配信先に変更はありませんでした',
	perChildProgressTitle: CHECKLIST_ADMIN_TERMS.perChildProgress,
	perChildProgressEmpty: '配信中のお子さまがいないため進捗は表示されません',
	perChildProgressDone: (childName: string, total: number) =>
		`${childName}: 今日のぶん ${total}/${total} 完了`,
	perChildProgressPartial: (childName: string, done: number, total: number) =>
		`${childName}: ${done}/${total}`,
	overflowMenuAriaLabel: 'チェックリスト管理メニュー',
	helpDialogTitle: 'チェックリスト ヘルプ',
	helpDialogDesc: `家族で 1 つのリストを作成し、配信先のお子さまを選ぶことで、同じリストを複数の${CHILD_TERMS.honorific}で共有できます。${CHILD_TERMS.honorific}ごとに今日の進捗が記録されます。`,
	// #3079: 個別 backup/restore 実装に伴い「今後対応予定」Dialog を撤去 (実機能に置換)。
	// 復元 dialog の文言は BACKUP_RESTORE_LABELS (共通 SSOT) を参照。restoreResourceNoun は
	// BACKUP_RESTORE_LABELS の文組み立て関数に渡す resource 名詞 (DESIGN.md §10 consistency)。
	restoreResourceNoun: 'チェックリスト',
	// テンプレート単位 export の選択 dialog 文言:
	exportSelectTitle: 'エクスポートするチェックリスト',
	exportSelectDesc: `1 つのチェックリストを選んで${BACKUP_TERMS.file}に書き出します。`,
	exportSelectEmpty: 'エクスポートできるチェックリストがありません',
	exportItemButton: (name: string) => `「${name}」をエクスポート`,
	importToastSuccess: (presetName: string, distributedCount: number) =>
		`「${presetName}」を取込み、${distributedCount}名のお子さまに配信しました`,
	importToastDuplicate: (presetName: string) =>
		`「${presetName}」は既に取込済みです（配信先のみ更新できます）`,
	// #2558 bug-1: デモ環境では書き込みが no-op 化される。成功偽装せず明示する。
	importToastDemo: 'デモではお試し用です（実際の追加は行われません）',
	importToastError: (presetName: string) =>
		`「${presetName}」の取込に失敗しました。時間をおいて再試行してください。`,
	importToastNotFound: (presetId: string) => `プリセット「${presetId}」が見つかりません。`,
	importInvalidPreset: '指定されたプリセットが見つかりませんでした',
	// #3098 (EPIC #3096 Sub-2): 子供主軸 UI 統一に伴う「別の子から copy」(= 配信先追加) 導線。
	//   activity の copy 導線 (ADMIN_ACTIVITIES_PAGE_LABELS.copy*) と同型語彙。
	// #4716: 3 画面で同じ呼称。CHECKLIST_ADMIN_TERMS.copyFromChild も同じ atom を指す
	copyFromChildMenuLabel: COPY_FROM_CHILD_LABELS.action,
	copyFromChildMenuIcon: '📋',
	copyDialogTitle: COPY_FROM_CHILD_LABELS.dialogTitle('チェックリスト'),
	copyDialogDescPrefix: 'コピー元を選んでください（コピー先: ',
	copyDialogDescSuffix: '）',
	copyDialogSelectedPlaceholder: '—',
	copyDialogAgeSuffix: '歳',
	copyDialogCountSuffix: '件',
	copyDialogEmpty: `他の${CHILD_TERMS.honorific}がいません`,
	copyDialogCancel: 'キャンセル',
	copyDialogConfirm: '取り込む',
	copyDifferentChildError: `違う${CHILD_TERMS.honorific}を選んでください`,
	// #4694: コピー結果文は CHILD_COPY_RESULT_LABELS (3 画面共通 SSOT) が組み立てる。
	// 本 namespace は resource 名だけを持つ (restoreResourceNoun と同型)。
	copyResourceNoun: 'チェックリスト',
	copyFailed: '取り込みに失敗しました',
	// #4512: +page.server.ts に直書きされていたチェックリスト固有の validation / 結果文言。
	// リソース非依存のものは ADMIN_FORM_ERROR_LABELS を参照する。
	timeSlotInvalid: '時間帯が不正です',
	overrideIdInvalid: 'オーバーライドIDが不正です',
	templateNameRequired: 'テンプレート名が必要です',
	distributionSyncFailed: '配信先の同期に失敗しました',
	copyAlreadyDistributedNote: (count: number) => `（${count} 件はすでに配信済みでした）`,
	restoreFallbackName: '復元したチェックリスト',
} as const;

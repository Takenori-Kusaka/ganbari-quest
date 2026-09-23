// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/activities。置き場所の規則は docs/DESIGN.md §6
import { ACTIVITY_ADMIN_TERMS, CHILD_TERMS } from '../terms';
import { COPY_FROM_CHILD_LABELS } from './admin-shared';
import { MARKETPLACE_IMPORT_FEEDBACK_LABELS } from './marketplace';

// ============================================================
// 活動優先度ラベル（#1755 / #1709-A: 「今日のおやくそく」）
// ============================================================
//
// activities.priority に対応するラベル定義。
// - must: 「今日のおやくそく」（保護者がフラグ立てした活動 → 子供 UI 専用セクションで強調表示）
// - optional: 「ふつうの活動」（既定）
//
// ※ #1168 で導入された CHECKLIST_KIND_LABELS（'item' / 'routine'）は本 Issue で削除。
//   旧 'routine' は activities.priority='must' に役割移管され、チェックリストは「持ち物」純化。

export const ACTIVITY_PRIORITY_LABELS = {
	must: '今日のおやくそく',
	optional: 'ふつうの活動',
} as const;

export type ActivityPriority = keyof typeof ACTIVITY_PRIORITY_LABELS;

export function getActivityPriorityLabel(priority: string): string {
	return (
		ACTIVITY_PRIORITY_LABELS[priority as ActivityPriority] ?? ACTIVITY_PRIORITY_LABELS.optional
	);
}

// 活動編集画面 (admin/activities/[id]/edit) での must トグル関連 UI 文言
export const ACTIVITY_PRIORITY_FORM_LABELS = {
	toggleSectionTitle: '今日のおやくそく',
	toggleLabel: '「今日のおやくそく」にする',
	toggleHint: `ON にすると、${CHILD_TERMS.honorific}の画面で「今日のおやくそく」セクションに表示され、毎日全達成でボーナスポイントが加算されます。`,
	mustBadge: '今日のおやくそく',
	optionalBadge: 'ふつう',
	editPageTitle: '活動を編集',
	editBackButton: '一覧へもどる',
	editSaveButton: '保存',
	editSavedMessage: '保存しました',
	editLoadFailed: '活動の読み込みに失敗しました',
	editNotFound: '活動が見つかりません',
} as const;

// ============================================================
// デモポイント変換ページ (#1452 Phase B)
// ============================================================

// ============================================================
// 実績ページ (#1452 Phase B)
// ============================================================

// ACHIEVEMENTS_LABELS: 実績機能廃止 (#1782 / #1816) で全 keys 参照ゼロのため namespace 削除 (#1833)

// ============================================================
// 活動紹介ページ (#1452 Phase B)
// ============================================================

export const ACTIVITIES_INTRODUCE_LABELS = {
	noActivitiesTitle: '表示できる活動がありません',
	noActivitiesDesc: 'まず活動を追加してください',
	backButton: 'もどる',
	progressSuffix: 'の活動',
	triggerHintGuide: 'つかいかたを みせてあげてね',
	triggerHintOpen: '「',
	triggerHintClose: '」',
	activityDescLabel: '活動の説明',
	noHintMessage: 'ヒントはまだ設定されていません',
	noHintEditNote: '活動編集画面で「トリガーヒント」を設定できます',
	prevButton: '← まえへ',
	nextButton: 'つぎへ →',
	finishButton: 'おわる',
} as const;

/**
 * ActivityCreateForm / ActivityEditForm 用共有ラベル (#1465 Phase D)
 */
export const ACTIVITY_FORM_LABELS = {
	createTitle: '活動を追加',
	nameLabel: '活動名',
	namePlaceholder: '例: おさんぽ、ピアノれんしゅう',
	categoryLabel: 'カテゴリ',
	mainIconLabel: 'メインアイコン',
	directInputLabel: '直接入力:',
	subIconLabel: 'サブアイコン（任意）',
	subIconNoneOption: 'なし',
	previewLabel: 'プレビュー:',
	pointsLabel: 'ポイント',
	ageRangeLabel: '対象年齢（省略可）',
	ageMinAria: '最小年齢',
	ageMaxAria: '最大年齢',
	ageRangeSeparator: '〜',
	ageUnit: '歳',
	dailyLimitLabel: '1日の回数制限',
	dailyLimitHint: '「無制限」なら何回でも記録できます',
	nameKanaLabel: 'ひらがな表記（省略可）',
	nameKanaPlaceholder: '例: おかたづけした',
	nameKanaHint: `6歳未満の${CHILD_TERMS.honorific}に表示する名前`,
	nameKanjiLabel: '漢字表記（省略可）',
	nameKanjiPlaceholder: '例: お片付けをした',
	nameKanjiHint: `6歳以上の${CHILD_TERMS.honorific}に表示する名前`,
	triggerHintLabel: 'トリガーヒント（省略可）',
	triggerHintPlaceholder: '例: はみがきが終わったら押してね',
	triggerHintHint: 'カードに小さく表示される声かけ文（30文字以内）',
	createSubmitDefault: '活動',
	createSubmitSuffix: ACTIVITY_ADMIN_TERMS.submitSuffix,
	// Edit-specific
	editNameLabel: '名前',
	editIconLabel: 'アイコン',
	editIconJoiner: '+',
	editIconSubPlaceholder: 'サブ',
	editPointsLabel: 'ポイント',
	editAgeMinLabel: '対象年齢（下限）',
	editAgeMaxLabel: '対象年齢（上限）',
	editAgePlaceholderNone: 'なし',
	editNameKanaLabel: 'ひらがな表記',
	editNameKanjiLabel: '漢字表記',
	editKanaPlaceholderOptional: '省略可',
	editTriggerHintLabel: `${CHILD_TERMS.honorific}へのヒント（いつ押すか）`,
	editTriggerHintPlaceholder: 'はみがきが終わったら押してね',
	editTriggerHintNote: 'カードの下に小さく表示されます（30文字まで）',
	editSaveButton: '保存',
	editDeleteButton: '削除',
	deleteHasLogsTitle: (count: number) => `この活動には ${count} 件の記録があります`,
	deleteHasLogsExplain: `記録を保護するため、完全削除ではなく「非表示」にします。非表示の活動は${CHILD_TERMS.honorific}の画面に表示されなくなりますが、過去の記録はそのまま残ります。`,
	deleteNoLogsConfirm: '本当に削除しますか？',
	deleteNoLogsExplain: 'この活動は完全に削除されます。この操作は取り消せません。',
	deleteHideButton: '非表示にする',
	deleteFullButton: '削除する',
	deleteCancelButton: 'キャンセル',
	deleteAutoHidMessage: '記録があるため非表示にしました',
} as const;

export const ADMIN_ACTIVITIES_PAGE_LABELS = {
	// #3097 (EPIC #3096): 検索ラベルを SSOT 化 (旧 inline hardcoded `活動名で検索` を labels へ移管)
	searchLabel: ACTIVITY_ADMIN_TERMS.search,
	searchPlaceholder: '🔍 活動名で検索...',
	// 子供別タブ
	childTabsAriaLabel: `${CHILD_TERMS.honorific}を選択`,
	childCountSuffix: '件',
	// 兄弟共通化 actions
	// #4716: 同じ操作の呼称は COPY_FROM_CHILD_LABELS.action に統一 (旧「📋 他の子供から copy」)
	copyFromChildButton: COPY_FROM_CHILD_LABELS.action,
	// #4693: copy / 一括追加の結果文言 (旧: +page.svelte に直書き、SSOT 逸脱)。
	// 失敗時はサーバーが返す理由 (上限 + アップグレード導線) を優先し、本文言は fallback。
	copySuccess: 'コピーが完了しました',
	copyFailed: 'コピーに失敗しました',
	bulkCreateSuccess: '一括追加しました',
	bulkCreateFailed: '一括追加に失敗しました',
	bulkCreateButton: '👨‍👩‍👧‍👦 一括追加',
	// 選択中 child banner
	childContextActivitiesSuffix: (count: number) => `の活動 (${count} 件)`,
	childContextHint: `タブを切り替えると、他の${CHILD_TERMS.honorific}の活動を表示します`,
	// copy dialog
	copyDialogTitle: COPY_FROM_CHILD_LABELS.dialogTitle('活動'),
	copyDialogDescPrefix: 'コピー元の',
	copyDialogDescSuffix: 'を選んでください (コピー先: ',
	copyDialogDescCloseParen: ')',
	copyDialogSelectedPlaceholder: '—',
	copyDialogAgeSuffix: '歳',
	copyDialogCountSuffix: '件',
	copyDialogEmpty: `他の${CHILD_TERMS.honorific}がいません`,
	copyDialogCancel: 'キャンセル',
	copyDialogConfirm: 'コピーする',
	// #4694: コピー結果文の resource 名 (checklists の restoreResourceNoun と同型)。
	// 結果文の組み立ては CHILD_COPY_RESULT_LABELS (3 画面共通 SSOT) が行う。
	copyResourceNoun: '活動',
	copyDifferentChildError: `違う${CHILD_TERMS.honorific}を選んでください`,
	// bulk dialog
	bulkDialogTitle: `複数の${CHILD_TERMS.honorific}に一括追加`,
	bulkFormName: '活動名',
	bulkFormPoints: 'ポイント',
	bulkFormCategory: 'カテゴリ',
	bulkFormIcon: 'アイコン (絵文字)',
	bulkTargetsLegend: `追加する${CHILD_TERMS.honorific}`,
	bulkTargetAll: '👨‍👩‍👧‍👦 全員に追加',
	bulkTargetChildAgeSuffix: '歳',
	bulkDialogCancel: 'キャンセル',
	bulkDialogConfirm: '追加する',
	// 取込ダイアログ後の result メッセージ (#2558: imported 件数で正直に出し分ける)
	importSuccess: (count: number) => `✨ ${count} 件の活動を追加しました`,
	// imported=0 (選んだ子に全て追加済み) — generic な「完了」で誤魔化さない
	importAllDuplicates: `選んだ${CHILD_TERMS.honorific}にはすでに追加済みです`,
	importFailed: '取込に失敗しました',
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	// #2818: 一部 (または全件) が保存できなかったとき正直に出す。
	// #2955: 文言の SSOT は MARKETPLACE_IMPORT_FEEDBACK_LABELS (3 admin page 横展開で共通化)。
	importPartialFailure: MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure,
	// Round 18 Cluster G (per-child scope badge): 英語内部語彙「per-child」UI 露出撤去 (ADR-0045 §9)
	// 「お子さま別」= per-child scope (個別 child に紐付く activity) を親向けに明示する短い表示
	scopeBadgePerChild: `${CHILD_TERMS.honorific}別`,
	// #2744 AC4 Delete UI (family scope): 一覧から活動を削除する確認 Dialog + 完了 Toast
	// #2754 Fix Round 1 B2: undo 経路不在の business risk を文言で明示
	// (ログ有 → 非表示で活動履歴は保全 / ログ無 → 物理削除でレコード復元不能)
	deleteBtn: ACTIVITY_ADMIN_TERMS.delete,
	deleteConfirmTitle: (name: string) => `${name} を削除しますか?`,
	deleteConfirmBody:
		'この操作は取り消せません。活動ログがある場合は「非表示」になり履歴は保全されますが、ログがない場合は完全に削除され復元できません。続行しますか?',
	deleteConfirmAction: '削除する',
	deleteCancel: 'キャンセル',
	deleteProcessing: '削除中...',
	deleteSuccess: '✨ 活動を削除しました',
	deleteFailed: '削除に失敗しました',
	// Round 18 Cluster J (#1870 評価 Round 3): family master activity の年齢適合フィルタ hint。
	// preschool 児童 context で「アルバイト」「大学受験」等 senior 向け activity が混在表示される
	// per-child scope 不整合を解消し、選択中 child の age に合う活動のみ既定表示する旨を明示。
	ageFilterAppliedHint: (name: string, age: number, visible: number, total: number) =>
		`${name}${CHILD_TERMS.honorific} (${age}歳) の年齢に合う ${visible} 件を表示中 (全 ${total} 件)`,
	ageFilterShowAll: '全件を表示',
	ageFilterBypassedHint: (name: string, age: number) =>
		`年齢フィルタ無効 (${name}${CHILD_TERMS.honorific} ${age}歳)。全 family scope activity を表示中`,
	ageFilterReapply: '年齢フィルタを再適用',
	// #4512: +page.svelte / +page.server.ts に直書きされていた活動固有の action 結果・
	// validation メッセージ。リソース非依存のものは ADMIN_FORM_ERROR_LABELS を参照する。
	// copySuccess / 一括追加の成功文言は #4693 / #4694 (develop) が上で定義済みのため
	// ここでは重複させない (後勝ちで先の定義が黙って死ぬのを避ける)。
	activityIdInvalid: '不正な活動IDです',
	activityNotFound: '活動が見つかりません',
	sameChildCopyNotAllowed: `同じ${CHILD_TERMS.honorific}にはコピーできません`,
	copySourceChildRequired: `コピー元の${CHILD_TERMS.honorific}が必要です`,
	copyTargetChildRequired: `コピー先の${CHILD_TERMS.honorific}が必要です`,
	noActivitiesSelectedToImport: '取り込む活動が選択されていません',
} as const;

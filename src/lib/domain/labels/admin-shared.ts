// labels 層 (ADR-0045 / #4965): 親の管理画面のリソース画面 (活動 / ごほうび / チェックリスト 等) に共通する部品の文言 (空状態・バックアップ復元・子供間コピー 等)。置き場所の規則は docs/DESIGN.md §6
import { ADD_MENU_TERMS, BACKUP_TERMS, CHILD_TERMS, OVERFLOW_MENU_TERMS } from '../terms';

// ============================================================
// ナビゲーション項目ラベル
// ============================================================

/**
 * 兄弟共通化（別のお子さまの設定をコピーする）操作の共通文言 (#4716)。
 *
 * 以前は活動「別のお子さまからコピー」/ ごほうび「📋 他の子供から copy」/ チェックリスト
 * 「他のお子さまから取り込む」の 3 表記に割れていた。同じ操作なので 1 箇所に置く。
 */
export const COPY_FROM_CHILD_LABELS = {
	/** + 追加 dropdown / ボタンのラベル (値の atom は ADD_MENU_TERMS.copyFromChild) */
	action: ADD_MENU_TERMS.copyFromChild,
	/** dropdown のアイコン (概念アイコンではないので registry 対象外) */
	icon: '👨‍👩‍👧',
	/** ダイアログ見出し。resource は「活動」「ごほうび」等 */
	dialogTitle: (resource: string) => `別の${CHILD_TERMS.honorific}から${resource}をコピー`,
} as const;

/**
 * admin/activities ページ用ラベル (#2362 PR-3 Phase 4)
 * 子供別タブ切替 + 兄弟共通化 UX (copy / 一括追加) の SSOT。
 */
/**
 * admin 各ページの form action が返す共通エラーメッセージ (#4512)
 *
 * `fail(400, { error: '名前を入力してください' })` のような同一文言が admin 配下の
 * `+page.server.ts` 11 ファイルに散在し、同じ語を最大 6 箇所で別々に持っていた
 * (docs/DESIGN.md §6 / ADR-0045)。ページ固有の文言は各ページの `*_PAGE_LABELS` に置き、
 * 「ID が不正」「保存に失敗」のようにリソース非依存で使い回されるものだけを本 namespace に集約する。
 *
 * 表示先は form の `form?.error` (顧客に見えるエラーバナー)。logger.* の内部ログ文言は
 * 顧客に見えないため対象外 (SSOT 集約しない)。
 */
export const ADMIN_FORM_ERROR_LABELS = {
	// ---- 識別子 ----
	idRequired: 'IDが必要です',
	idInvalid: 'IDが不正です',
	presetIdRequired: 'プリセットIDが必要です',
	presetNotFound: 'プリセットが見つかりません',
	presetNotFoundNamed: (presetId: string) => `プリセット「${presetId}」が見つかりません`,
	presetNotSpecified: 'プリセットが指定されていません',
	packIdRequired: 'パックIDが必要です',
	packNotFound: 'パックが見つかりません',
	templateIdInvalid: 'テンプレートIDが不正です',
	itemIdInvalid: 'アイテムIDが不正です',
	// ---- 入力必須 ----
	nameRequired: '名前を入力してください',
	itemNameRequired: 'アイテム名を入力してください',
	itemInvalid: 'アイテムが不正です',
	categoryRequired: 'カテゴリを選択してください',
	dateRequired: '日付を入力してください',
	requiredFieldsMissing: '必須項目が不足しています',
	// ---- 子供の指定 ----
	childRequired: 'こどもを選択してください',
	childRequiredHonorific: `${CHILD_TERMS.honorific}を選択してください`,
	targetChildRequired: `対象の${CHILD_TERMS.honorific}を選択してください`,
	sameChildNotAllowed: `違う${CHILD_TERMS.honorific}を選んでください`,
	childNotFound: 'こどもが見つかりません',
	childNotFoundNeutral: `${CHILD_TERMS.neutral}が見つかりません`,
	someChildrenNotFound: `指定された${CHILD_TERMS.honorific}の一部が見つかりませんでした`,
	childrenNotFound: `指定された${CHILD_TERMS.honorific}が見つかりませんでした`,
	noValidTargets: '有効な対象が指定されていません',
	// ---- 保存系の失敗 ----
	addFailed: '追加に失敗しました',
	updateFailed: '更新に失敗しました',
	deleteFailed: '削除に失敗しました',
	importFailed: 'インポートに失敗しました',
	copyFailed: 'コピーに失敗しました',
	bulkAddFailed: '一括追加に失敗しました',
	bulkClearFailed: '一括クリアに失敗しました',
	fileParseFailed: 'ファイルの解析に失敗しました',
	genericError: 'エラーが発生しました',
} as const;

/**
 * admin リソース画面の「選択中の子と操作対象」共通ラベル (#4692)
 *
 * 復元 / エクスポート / すべて削除 / 取込 は per-child 主軸 (ADR-0055、DESIGN.md §10) に従い
 * 「選択中の子」だけを対象にする。対象範囲を書かない確認文 (旧「本当に全削除しますか？」) や
 * 子供 0 人での空 dialog は「操作対象がどこか分からない」状態を作るため、
 * 3 画面 (活動 / ごほうび / チェックリスト) で同一文言を使う。
 */
export const ADMIN_CHILD_SCOPE_LABELS = {
	childRequired: `${CHILD_TERMS.honorific}を選んでください`,
	childNotFound: `指定された${CHILD_TERMS.honorific}が見つかりませんでした`,
	/** 子供 0 人で取込 URL (`?import=`) を開いたときの案内 (空 dialog の代わり) */
	noChildrenTitle: `まずは${CHILD_TERMS.honorific}を登録してください`,
	noChildrenDesc: `取り込み先の${CHILD_TERMS.honorific}がまだ登録されていません。登録すると、みんなのテンプレートを取り込めます。`,
	noChildrenCta: `${CHILD_TERMS.honorific}を登録する`,
	/** ︙「すべて削除」の確認文 — 対象の子と件数を必ず出す */
	clearAllScopedConfirm: (childName: string, count: number) =>
		`${childName}の活動 ${count} 件をすべて削除します（他の${CHILD_TERMS.honorific}の活動は消えません）`,
	/** 復元 / エクスポートの対象範囲を dialog / menu で明示する短い注記 */
	scopedToChildHint: (childName: string) => `対象: ${childName}のみ`,
} as const;

/**
 * 「別のお子さまからコピー」の結果メッセージ SSOT (#4694)
 *
 * 活動 / ごほうび / チェックリストの 3 画面で同じ判定 (すでにあるものは作らない) を行い、
 * 同じ形で「作った件数 / 既にあって作らなかった件数」を返す (NN/G #1 visibility of system status)。
 * 旧実装は「コピーが完了しました」だけを出していたため、2 回押して二重登録されたことにも、
 * 何も起きなかったことにも気づけなかった。
 */
export const CHILD_COPY_RESULT_LABELS = {
	/**
	 * @param resourceNoun 「活動」「ごほうび」「チェックリスト」
	 * @param copied 実際に作成した件数
	 * @param skipped 既に同じものがあり作成しなかった件数
	 */
	format: (resourceNoun: string, copied: number, skipped: number): string => {
		if (copied === 0) {
			return skipped > 0
				? `コピーできる${resourceNoun}はありませんでした（${skipped} 件はすでに追加済みです）`
				: `コピーできる${resourceNoun}がありませんでした`;
		}
		return skipped > 0
			? `📋 ${copied} 件の${resourceNoun}をコピーしました（${skipped} 件はすでにあるためスキップ）`
			: `📋 ${copied} 件の${resourceNoun}をコピーしました`;
	},
	/** 結果に応じた Toast のトーン (0 件は成功と呼ばない) */
	tone: (copied: number): 'success' | 'info' => (copied > 0 ? 'success' : 'info'),
	/** コピー実行中のボタン文言 (DESIGN.md §5 Button loading) */
	copying: 'コピーしています…',
	/**
	 * デモ環境 (write no-op) の結果表示。取込 / 復元の demo 分岐と同型 (#2558 bug-1)。
	 * demo は書き込みを行わないので件数は常に 0 で返る。これを実結果として
	 * 「コピーできる○○がありませんでした」と出すと、デモを触った人に
	 * 「重複していないのにコピーできない」と誤解させるため、demo と明示する。
	 */
	demo: (resourceNoun: string): string =>
		`デモではお試し用です（実際の${resourceNoun}のコピーは行われません）`,
} as const;

/**
 * 個別 backup/restore 共通ラベル (#3079、DESIGN.md §10 consistency)
 *
 * 活動 (ActivitiesHeader) と同型の「エクスポート」+「バックアップから復元」を、ごほうび・
 * チェックリストでも UX 同型に出すための共通ラベル SSOT。overflow menu item ラベル / アイコンは
 * OVERFLOW_MENU_TERMS atom を参照 (ADR-0045)。preview → 実行の 2 段フロー文言もここに集約する。
 *
 * resourceNoun は呼出側で渡す (「ごほうび」/「チェックリスト」)。同一概念を 2 箇所にハードコード
 * しないため、文を組み立てる関数は引数で resourceNoun を受け取る形にする。
 */
export const BACKUP_RESTORE_LABELS = {
	restoreLabel: OVERFLOW_MENU_TERMS.itemRestore,
	restoreIcon: OVERFLOW_MENU_TERMS.itemRestoreIcon,
	exportLabel: OVERFLOW_MENU_TERMS.itemExport,
	exportIcon: OVERFLOW_MENU_TERMS.itemExportIcon,
	restoreDialogTitle: `📥 ${OVERFLOW_MENU_TERMS.itemRestore}`,
	restoreDialogDesc: (resourceNoun: string) =>
		`以前書き出した${resourceNoun}の${BACKUP_TERMS.file}を読み込んで復元します。みんなのテンプレートの取り込みとは別の機能です。`,
	fileRequired: 'ファイルを選択してください',
	fileFallbackName: 'ファイル',
	checkButton: '内容を確認',
	checking: '確認中…',
	restoreSubmitBtn: '復元する',
	restoreProcessing: '復元中…',
	cancelButton: 'キャンセル',
	backButton: '選び直す',
	previewHeading: '復元する内容',
	previewSummary: (total: number, newItems: number, duplicates: number) =>
		`全 ${total} 件（新規 ${newItems} 件 / 既存のためスキップ ${duplicates} 件）`,
	previewAllDuplicates: (resourceNoun: string) => `この${resourceNoun}はすべて既に登録済みです`,
	restoreSuccess: (name: string, imported: number, skipped: number) =>
		skipped > 0
			? `✨ 「${name}」から ${imported} 件を復元しました (${skipped} 件は既存のためスキップ)`
			: `✨ 「${name}」から ${imported} 件を復元しました`,
	restoreAllDuplicatesResult: (name: string, resourceNoun: string) =>
		`「${name}」の${resourceNoun}はすべて既に登録済みです`,
	restoreFailed: '復元に失敗しました',
	exportFailed: 'エクスポートに失敗しました',
	exportEmpty: (resourceNoun: string) => `エクスポートする${resourceNoun}がありません`,
} as const;

// ============================================================
// OverflowMenu (EPIC #2362 PR-2) — admin route 共通 ⋮ menu 表示文字列
// ============================================================
//
// admin route (activity / reward / challenge / checklist / rule bonus) の
// top-right ⋮ menu の標準項目を SSOT 集約。各 route で項目 ON/OFF 可能 (props 制御)。
// terms.ts OVERFLOW_MENU_TERMS atom を template literal で参照。

export const OVERFLOW_MENU_LABELS = {
	openLabel: `${OVERFLOW_MENU_TERMS.openLabel}`,
	items: {
		marketplace: {
			id: 'marketplace',
			label: `${OVERFLOW_MENU_TERMS.itemMarketplace}`,
			icon: `${OVERFLOW_MENU_TERMS.itemMarketplaceIcon}`,
		},
		aiSuggest: {
			id: 'ai-suggest',
			label: `${OVERFLOW_MENU_TERMS.itemAiSuggest}`,
			icon: `${OVERFLOW_MENU_TERMS.itemAiSuggestIcon}`,
		},
		restore: {
			id: 'restore',
			label: `${OVERFLOW_MENU_TERMS.itemRestore}`,
			icon: `${OVERFLOW_MENU_TERMS.itemRestoreIcon}`,
		},
		export: {
			id: 'export',
			label: `${OVERFLOW_MENU_TERMS.itemExport}`,
			icon: `${OVERFLOW_MENU_TERMS.itemExportIcon}`,
		},
		help: {
			id: 'help',
			label: `${OVERFLOW_MENU_TERMS.itemHelp}`,
			icon: `${OVERFLOW_MENU_TERMS.itemHelpIcon}`,
		},
	},
} as const;

export const UNIFIED_EMPTY_STATE_LABELS = {
	// 5 admin リソース共通の empty state テキスト
	icon: '📋',
	// resource 名を埋め込むため関数形式
	noItems: (resourceName: string) => `${resourceName}がまだありません`,
	filteredText: '条件に一致するものがありません',
	addBtn: '＋ 新しく作る',
	importBtn: '📥 取り込みで追加する',
	// Reward / Checklist 等で childId 必須な場合の補助文言
	pickChildHint: `対象の${CHILD_TERMS.honorific}を選んでから取り込みできます。`,
	disabledReason: '権限が不足しています',
} as const;

/**
 * 参照先のレコードを解決できなかったときの表示名 (#4538)。
 *
 * 内部 ID (`#${childId}` 等) を表示名のフォールバックにしない (DESIGN.md §6「内部コード露出禁止」、
 * 過去事例 #498 / #573)。UUID が画面に出ても顧客には意味が無く、誰のことか分からないうえ、
 * 内部識別子を不必要に露出する。**画面 (子供 / 親) を問わず本ラベルを使う**。
 *
 * 出る条件は「一覧に載っていない子供 / 定義が無いカテゴリを参照している」= データ不整合であり、
 * 通常運用では出ない。出たときに「不明である」と正直に述べるのが正しい (存在しない名前を作らない)。
 *
 * 子供画面側の同種フォールバックは `CHILD_HOME_LABELS.siblingUnknownName` (「きょうだい」)。
 * 読み手が違う (子供 = ひらがな / 親 = 敬称) ため値は分けるが、**内部 ID を出さない**点は共通で、
 * `tests/unit/architecture/child-ui-display-integrity.test.ts` が両 scope をまとめて guard する。
 */
export const UNRESOLVED_ENTITY_LABELS = {
	/** children 一覧から引けなかった子供の表示名 */
	child: `不明な${CHILD_TERMS.honorific}`,
	/** カテゴリ定義から引けなかったカテゴリの表示名 */
	category: '不明なカテゴリ',
	/** 認証基盤から email を解決できなかったメンバーの表示 (#4512) */
	email: '(不明)',
} as const;

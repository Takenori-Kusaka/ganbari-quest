// labels 層 (ADR-0045 / #4965): Storybook の表示テキスト (docs/DESIGN.md §6 Storybook ラベル言語ポリシー)。置き場所の規則は docs/DESIGN.md §6
import { ADD_MENU_TERMS, PLAN_FULL_TERMS, REWARD_ADMIN_TERMS } from '../terms';
import { ADMIN_REWARDS_PAGE_LABELS } from './admin-rewards';

/**
 * Storybook stories.svelte で表示するラベル群（#1738、#1465 follow-up）
 *
 * **言語ポリシー**: Storybook の Story 名（サイドバー表示の `Primary` / `Default` 等）は
 * Storybook の慣習に従い英語のままとする。一方、コンポーネントの**表示テキスト**
 * （子要素・`message` プロパティ・トースト本文・ボタンラベル等）は本プロダクトの
 * 表示言語（日本語）に統一する。理由:
 *
 * 1. アプリ本体 UI は全て日本語であり、Storybook で実際の見た目を確認する用途上
 *    日本語で揃える方が UI 折り返し（旧 ADR-0016、方針は docs/DESIGN.md §3）・タイポグラフィ検証で有用
 * 2. 既存 stories の多数派（Alert / FormField / IconButton / NativeSelect / Select /
 *    BirthdayInput / ErrorAlert）が既に日本語で実装されており、Badge / Button / Card /
 *    LoadingButton / Toast の英語表示テキストだけが不一致だった
 * 3. labels.ts SSOT との一貫性（ADR-0009）
 *
 * 詳細は `docs/DESIGN.md` §6 「Storybook ラベル言語ポリシー」を参照。
 */
export const STORYBOOK_LABELS = {
	buttonDefault: 'ボタン',
	loading: '読み込み中...',
	// #4767: CloudExportStoredList の見た目確認用 (demo 環境は cloud 行を持たないため SS が撮れない)。
	cloudExportStoredList: {
		descriptionTemplate: '活動12件（2人分）、チェックリスト3件',
		descriptionFull: 'フルバックアップ（子供2人、ログ340件、画像同梱）',
		failureReason: 'ビルドがタイムアウトしました。再度エクスポートしてください',
	},
	badgeDefault: 'バッジ',
	cardDefault: 'カード',
	toastDefault: 'トースト',
	selectDefault: '選択',
	featureGate: {
		buttonLabel: 'クラウドエクスポート',
		unlockedContent: 'この機能は利用できます',
		sectionTitle: 'AI 提案パネル',
		// #4992: 一覧の行に置くロックした操作 (ごほうび管理の「編集」) と、押す前に読める理由の注記
		rowButtonLabel: REWARD_ADMIN_TERMS.edit,
		reasonNote: ADMIN_REWARDS_PAGE_LABELS.editLockedNote,
	},
	// #2573: Stripe Checkout の申込確定ボタン直前に出る文言 (`custom_text.submit.message`) は
	// Stripe 側が描画するため、demo 環境でも本番でも手元で SS を撮れない。
	// 本 story が「顧客が確定前に何を読むか」の視覚証跡になる (SS 規約の ss-render-impossible)。
	// 本文そのものは CHECKOUT_LABELS.submitMessage が SSOT なので story 側で複製しない。
	checkoutSubmitMessage: {
		caption: 'Stripe の申込確定ボタンの直前に表示される文言',
	},
	// #4172: SpecialRewardOverlay の見た目確認用。棚に並んだごほうび名 (親が登録した現実世界の報酬)。
	specialRewardOverlay: {
		title: 'ゲーム 30 分',
		titleLong: 'にちようびに こうえんで あそぶ',
	},
	// #4841: StampPressOverlay (ログインボーナス受取) の年齢帯文体を目視するための固定値。
	// 実環境 (`DATA_SOURCE=demo`) では当日の押印状態を作れず SS 撮影で描画できないため、
	// 本 story が junior / senior 文体の視覚証跡になる。
	stampPressOverlay: {
		stampName: 'だいきち',
	},
	// #4841: ParentMessageOverlay (応援メッセージ) の年齢帯文体を目視するための固定値。
	// demo repo (`db/demo/message-repo.ts`) は未読メッセージを常に undefined で返すため
	// 実環境の SS 撮影で描画できない。本 story が視覚証跡になる。
	parentMessageOverlay: {
		body: 'テストがんばったね。応援してるよ',
		icon: '💌',
	},
	// #4429: AvatarDisplay の見た目確認用。取得失敗時に 👤 へ落ちることを目視できるようにする。
	avatarDisplay: {
		nickname: 'たろう',
	},
	// 初回訪問の子供にだけ出る冒険スタート演出。`isFirstTime = !hasRecords` が条件で、
	// SS 撮影に使う demo 環境 (`DATA_SOURCE=demo`) の子供は記録済のため描画できない。
	// 本 story が年齢帯文体 (幼児ひらがな / 13-18 歳漢字) と活動 0 件時の視覚証跡になる。
	adventureStartOverlay: {
		childName: 'はると',
	},
	// #4538: SiblingChallengeComparison の見た目確認用。children 一覧から引けない childId が
	// あるときに内部 ID ではなく汎用語へ落ちることを目視できるようにする。
	siblingChallengeComparison: {
		challengeTitle: '今週は毎日おてつだい',
		firstChildNickname: 'はると',
		secondChildNickname: 'ひなた',
	},
	button: {
		primary: 'プライマリ',
		secondary: 'セカンダリ',
		danger: '削除',
		ghost: 'ゴースト',
		success: '成功',
		outline: 'アウトライン',
		small: '小',
		medium: '中',
		large: '大',
		disabled: '無効',
		loading: '取込中',
	},
	loadingButton: {
		save: '保存',
		saving: '保存中...',
		child: '子供',
		childSaving: '保存中...',
		send: '送信',
		sending: '送信中...',
	},
	badge: {
		success: '成功',
		warning: '警告',
		danger: 'エラー',
		info: '情報',
		neutral: 'ノーマル',
		accent: 'アクセント',
		small: '小',
		medium: '中',
	},
	card: {
		default: '通常カード',
		elevated: '浮き上がりカード',
		outlined: '枠線カード',
		paddingNone: '余白なし',
		paddingSm: '余白 小',
		paddingMd: '余白 中',
		paddingLg: '余白 大',
	},
	toast: {
		successTitle: '保存しました',
		successDesc: '変更を反映しました',
		successBtn: '成功トーストを表示',
		errorTitle: 'エラーが発生しました',
		errorDesc: '時間をおいて再度お試しください',
		errorBtn: 'エラートーストを表示',
		infoTitle: 'お知らせ',
		infoDesc: 'メンテナンスの予定があります',
		infoBtn: '情報トーストを表示',
		titleOnlyTitle: 'タイトルのみのお知らせ',
		titleOnlyBtn: 'タイトルのみトーストを表示',
		// PR #4839: 子供画面の form action 失敗通知 (拒否理由あり / なし) の見た目確認用。
		// 上限に達した理由が年齢帯別の文言で出ることを Storybook で目視確認する
		// (demo 環境では上限分岐に到達できないため SS が撮れない。PR body の ss-render-impossible 参照)。
		childReasonHiraganaBtn: 'ひらがな帯: 上限の理由つきで通知',
		childReasonKanjiBtn: '漢字帯: 上限の理由つきで通知',
		childReasonGenericBtn: '理由なし: 汎用文言にフォールバック',
	},
	alert: {
		successMessage: '保存しました！',
		warningMessage: '入力内容を確認してください',
		dangerMessage: 'エラーが発生しました',
		infoMessage: 'お知らせがあります',
	},
	errorAlert: {
		defaultMessage: 'データの読み込みに失敗しました。',
		warningMessage: 'セッションの有効期限が近づいています。',
		infoMessage: 'メンテナンスのお知らせ: 明日 AM2:00-4:00 にサーバーメンテナンスを実施します。',
		retryActionMessage: 'サーバーに接続できませんでした。',
		retryButtonMessage: 'データの保存に失敗しました。',
		retryAlertMessage: 'リトライを実行しました',
		fixInputMessage: 'PINコードが正しくありません。',
		contactAdminMessage: '予期しないエラーが発生しました。',
		successSeverity: '正常に処理されました。',
		warningSeverity: '操作の確認が必要です。',
		errorSeverity: 'エラーが発生しました。',
		actionNoneMessage: 'アクションなし',
		actionRetryTextMessage: 'リトライ案内 (テキストのみ)',
		actionRetryButtonMessage: 'リトライボタン付き',
		actionFixInputMessage: '入力修正を案内',
		actionContactAdminMessage: '管理者への連絡を案内',
		retryClickAlert: 'リトライ',
		longMessage:
			'データベースへの接続がタイムアウトしました。サーバーが高負荷状態にある可能性があります。しばらく時間をおいてから再度お試しください。問題が続く場合は管理者までお問い合わせください。',
	},
	birthdayInput: {
		labelDefault: 'おたんじょうび',
		errorInvalid: '有効な日付を入力してください。',
	},
	divider: {
		labelOr: 'または',
	},
	formField: {
		labelNickname: 'ニックネーム',
		placeholderNickname: 'たろうくん',
		labelEmail: 'メールアドレス',
		placeholderEmail: 'user@example.com',
		labelPassword: 'パスワード',
		labelAge: '年齢',
		labelTel: '電話番号',
		placeholderTel: '090-1234-5678',
		labelBirthday: '生年月日',
		labelReminderTime: 'リマインダー時刻',
		labelMemo: 'メモ',
		placeholderMemo: '自由記入...',
		labelMemoLong: '長文メモ',
		placeholderMemoLong: '8 行...',
		labelName: '名前',
		errorRequired: '入力が必要です',
		labelDisplayName: '表示名',
		hintDisplayName: '3〜20文字で入力してください',
		errorMemoMax: '500 文字以内で入力してください',
		labelDisabled: '無効なフィールド',
		valueDisabled: '編集不可',
		labelDisabledMemo: '無効メモ',
		valueDisabledMemo: '編集不可のテキスト',
	},
	iconButton: {
		labelEdit: '編集',
		labelDelete: '削除',
		labelClose: '閉じる',
		labelWarning: '注意',
		labelConfirm: '確認',
		labelSmall: '小',
		labelMedium: '中',
		labelLarge: '大',
	},
	nativeSelect: {
		labelTheme: 'テーマ',
		labelYear: '年',
		placeholder: '選択してください',
		hintLater: '後で変更できます',
		errorRequired: '選択してください',
		labelPlan: 'プラン',
		optionPlanFree: 'フリープラン',
		optionPlanStandard: `${PLAN_FULL_TERMS.standard}`,
		optionPlanFamily: `${PLAN_FULL_TERMS.premium} (準備中)`,
		optionThemeForest: 'もりのテーマ',
		optionThemeOcean: 'うみのテーマ',
		optionThemeSpace: 'うちゅうのテーマ',
	},
	select: {
		labelYear: '年',
		labelTheme: 'テーマカラー',
		placeholder: '選択してください',
		errorRequired: '選択してください',
		labelItem: 'アイテム',
		placeholderItem: 'アイテムを選択',
		itemPrefix: 'アイテム',
	},
	// Menu primitive (#2254 / EPIC #2253)
	menu: {
		triggerLabel: 'メニューを開く',
		triggerButton: '操作メニュー',
		itemEdit: '編集',
		itemDuplicate: '複製',
		itemArchive: 'アーカイブ',
		itemDelete: '削除',
		itemDeleteIcon: '🗑',
		itemEditIcon: '✏️',
		itemDuplicateIcon: '📄',
		itemArchiveIcon: '📦',
		itemDisabled: '無効な操作',
		ariaLabelOpen: 'メニューを開く',
	},
	logo: {
		captionSymbol: 'symbol',
		captionCompact: 'compact',
		captionFull: 'full',
	},
	// OverflowMenu primitive (EPIC #2362 PR-2)
	overflowMenu: {
		ariaLabelOpen: 'メニューを開く',
		itemMarketplace: 'みんなのテンプレから取込',
		itemAiSuggest: 'AI で提案してもらう',
		itemRestore: 'バックアップから復元',
		itemExport: 'エクスポート',
		itemHelp: 'このページのヘルプ',
	},
	// ChildSelectionDialog primitive (EPIC #2362 PR-2)
	childSelectionDialog: {
		triggerOpen: '取込先を選ぶ',
		childTaro: 'たろう (8 歳)',
		childHina: 'ひな (5 歳)',
		childKenta: 'けんた (1 歳)',
		childTaroIcon: '👦',
		childHinaIcon: '👧',
		childKentaIcon: '👶',
		emptyMessage: 'お子さまが登録されていません',
	},
	// VisibilityChipGroup primitive (EPIC #2362 PR-2)
	visibilityChipGroup: {
		childTaro: 'たろう (8 歳)',
		childHina: 'ひな (5 歳)',
		childKenta: 'けんた (1 歳)',
	},
	// Dialog primitive (CX-DoR #8、modal / 子供 最頻 UX の play coverage)
	dialog: {
		title: 'お知らせ',
		bodyText: 'この内容でよろしいですか？',
		confirmButton: 'はい',
		cancelButton: 'いいえ',
		ariaLabel: '確認ダイアログ',
		openTrigger: 'ダイアログを開く',
	},
	// #2821: SetupResumeBanner story の mock onboarding item label
	// (onboarding-service.ts の文言を反映。Storybook 専用 namespace、本番 SSOT と独立)。
	setupResumeBanner: {
		itemChildren: '子供を登録する',
		itemRewards: 'ごほうびプリセットを選ぶ',
		itemChecklist: 'チェックリストを作る',
		itemChildScreen: '子供の画面を確認する',
	},
	// #2998: AdminResourceHeader story の mock 文言 (3 画面共通ヘッダーの play coverage、CX-DoR #8)。
	adminResourceHeader: {
		title: '活動管理',
		description: 'お子さまの活動を登録・編集します',
		addButtonLabel: '+ 追加',
		addMenuAriaLabel: '追加メニューを開く',
		addManual: ADD_MENU_TERMS.manual,
		addAi: ADD_MENU_TERMS.ai,
		addBrowse: ADD_MENU_TERMS.browse,
		overflowTrigger: '︙',
		overflowAriaLabel: 'その他の操作',
		overflowRestore: 'バックアップから復元',
		overflowExport: 'エクスポート',
		badge: '有料限定',
	},
	// #4302 follow-up: SaasLicensePanel story の mock 契約者名。
	// portal-fallback-notice (Stripe が flow を拒否したときのみ描画) は demo 環境で撮影できないため
	// (ss-render-impossible)、story の play で見た目を固定する (#4166)。
	saasLicensePanel: {
		tenantName: 'たろう家',
	},
	// #4528: DowngradeResourceSelector story の mock 表示テキスト。
	// ダウングレード確認ダイアログは有料契約 (tenant の stripeSubscriptionId) が無いと開かず、
	// local backend は tenants を持たないため撮影できない (ss-render-impossible)。
	// 保持期間短縮警告の見た目は story で固定する。
	downgradeResourceSelector: {
		childOne: 'たろう',
		childTwo: 'はなこ',
		childThree: 'じろう',
		activityOne: '歯みがき',
		activityTwo: 'お手伝い',
		activityThree: '音読',
		activityFour: 'ストレッチ',
	},
} as const;

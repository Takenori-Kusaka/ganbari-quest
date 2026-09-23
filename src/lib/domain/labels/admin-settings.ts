// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/settings/** (サブページ・rules を含む)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import {
	BACKUP_TERMS,
	CANCEL_TERMS,
	CHILD_TERMS,
	CONCEPT_ICONS,
	CURRENCY_TERMS,
	OYAKAGI_TERMS,
	PARENT_TERMS,
	PLAN_FULL_TERMS,
	PLAN_TERMS,
	REWARD_TERMS,
	RULES_TERMS,
} from '../terms';
import { ACTIVITY_QUOTA_LABELS } from './plan';

// #4676: PAGE_GUIDE_LABELS.adminRewardsRequests が設定 > ルールの見出しを参照するため前置きする
export const ADMIN_RULES_PAGE_LABELS = {
	// #3954: 本画面は #3339 で「ごほうび交換の承認要否」も持つようになったが、title / description は
	// ボーナスルールしか説明しておらず、探しに来た保護者が「ここではない」と引き返す状態だった。
	// hub カード (SETTINGS_LABELS.groupRulesTitle) と同じ名前にして、同じものを指すと分かるようにする。
	pageTitle: 'ごほうび・ボーナスルール',
	pageDescription:
		'ごほうび交換に保護者の承認が必要かどうかと、活動記録時に発火するボーナスポイントのルールを設定できます。',
	emptyTitle: 'ボーナスルールがありません',
	// #4666 F6: 操作名は実ボタン (有効化 / 無効化) を正とする。「ON / OFF」は同じ操作の別名。
	emptyDesc: 'ボーナスルールを取込むと、ここで 有効化 / 無効化 を切り替えられます',
	sectionBonusTitle: `${CONCEPT_ICONS.challenge} ボーナスルール`,
	sectionBonusDesc:
		'活動記録時に発火するボーナスポイント。有効なルールのみが活動記録時に評価されます。',
	enabledBadge: '有効',
	disabledBadge: '無効',
	enableButton: '有効化',
	disableButton: '無効化',
	removeButton: '削除',
	removeConfirmTitle: 'このルールを削除しますか？',
	// #4666 F7: 内部語の英字 (rule) が顧客に見える確認ダイアログに出ていた。
	removeConfirm: '本当に削除しますか？取り込んだルールは元に戻せません。',
	importedAtLabel: '取込日時',
	rulesLabel: '含まれるルール',
	pointBonusSuffix: 'pt',
	updateSuccess: 'ルールを更新しました',
	removeSuccess: 'ルールを削除しました',
	// marketplace 詳細 → `?import=<presetId>` bonus auto-import の toast (family scope、即取込)。
	importToastSuccess: (presetName: string) =>
		`ボーナスルール「${presetName}」を取込みました。家族全員に適用されます。`,
	importToastDuplicate: (presetName: string) => `「${presetName}」は既に取込済みです。`,
	importToastError: (presetName: string) =>
		`「${presetName}」の取込に失敗しました。時間をおいて再試行してください。`,
	importToastNotFound: (presetId: string) => `プリセット「${presetId}」が見つかりません。`,
	// #4711: 種類違い (exchange / penalty / special) は「失敗 → 再試行」ではなく、
	// 取り込める画面 (交換型 = ごほうび管理) を案内する。内部 ID は出さない。
	importToastWrongType: (presetName: string) =>
		`「${presetName}」はボーナスルールではないため、この画面では取り込めません。`,
	importWrongTypeExchangeHint: `交換型のルールは${REWARD_TERMS.menu}で取り込みます。`,
	importWrongTypeGoToRewards: `${REWARD_TERMS.menu}で取り込む`,
	importWrongTypeNotImportable: 'このルールは取込対象外です。',
	// #2823: demo 環境の no-op 取込を正直に明示 (他 4 type と同文言、5 type 統一)。
	importDemo: 'デモではお試し用です（実際の追加は行われません）',
	// #4512: form action の失敗メッセージ (旧: +page.server.ts 直書き)
	rewardApprovalUpdateFailed: 'ごほうび交換設定の更新に失敗しました',
	updateFailed: 'ルール更新に失敗しました',
	removeFailed: 'ルール削除に失敗しました',
	// #3339: ごほうび交換の即時交換（親承認スキップ）設定。既定 = 承認必須。
	rewardApprovalSectionTitle: `${CONCEPT_ICONS.reward} ごほうび交換のしかた`,
	rewardApprovalSectionDesc:
		'お子さまがごほうびショップで交換するとき、保護者の承認を必須にするかを選べます。',
	rewardApprovalRequireState: '保護者の承認が必要',
	rewardApprovalInstantState: '承認なしで即時交換',
	rewardApprovalRequireDesc:
		'お子さまの交換は「承認待ち」になり、保護者が承認するとポイントが引かれます（初期設定）。',
	rewardApprovalInstantDesc:
		'お子さまがためたポイントで、承認を待たずにその場で交換できます（ポイントはその場で引かれます）。',
	rewardApprovalEnableInstantButton: '即時交換にする',
	rewardApprovalDisableInstantButton: '承認を必須に戻す',
	rewardApprovalSuccess: 'ごほうび交換の設定を更新しました',
	// #4023: 承認必須を「外す」方向 (承認必須 → 即時交換) にだけ確認を挟む。
	// 承認必須に戻す安全側の操作は確認しない (AC2)。文言は「よろしいですか」で終わらせず
	// 解除後に何が起きるか (結果) を書く (AC3)。
	rewardApprovalInstantConfirmTitle: '承認なしで交換できるようにしますか？',
	rewardApprovalInstantConfirmBody:
		'解除すると、お子さまは保護者の承認なしでポイントを使ってごほうびと交換できるようになります。あとから「承認を必須に戻す」でいつでも元に戻せます。',
} as const;

// ============================================================
// インポート関連（#1254）
// ============================================================

/**
 * 家族データインポート機能のラベル SSOT (#1254)
 * エラーメッセージ、ダイアログ文言、スキップ理由など
 */
// #4752: 自動復元まで失敗した半端な状態の顧客向け文言 (IMPORT_LABELS.errorReplaceRestoreFailed* の基底)。
const REPLACE_RESTORE_FAILED_MESSAGE = `インポートに失敗し、元のデータへの自動復元も途中で止まりました。現在のデータは不完全な状態です。元のデータは復旧用${BACKUP_TERMS.canonical}として保存されているため、設定 > サポートから運営にご連絡ください。運営が復元します`;

export const IMPORT_LABELS = {
	// エラーメッセージ
	errorChecksumMismatch: 'ファイルが破損しているか改ざんされています',
	// #3201: parse 失敗 (= そもそもバックアップ形式でない) を checksum 不一致 (= 破損 / 改ざん) と
	// 区別できる文言に是正 + /api/v1/import の parse 失敗経路に配線 (旧: 'JSONの解析に失敗しました' 直書き)。
	// 内部フォーマット名 (JSON) は UI 露出しない (BACKUP_TERMS SSOT、#3198)。
	errorInvalidJson: `${BACKUP_TERMS.file}として読み込めませんでした（ファイルの形式が正しくありません）`,
	errorImportFailed: 'インポートに失敗しました',
	// #3325 AC3: 実行環境の実効上限 (AWS = Function URL 6MB 弱) 超過時のエラー + クラウド導線案内。
	// API (import/+server.ts) と UI (settings/data の送信前 pre-check) の双方で共有する。
	errorFileTooLargeCloudGuide: (maxMb: number | string) =>
		`ファイルサイズが大きすぎます（最大${maxMb}MB）。大きな${BACKUP_TERMS.canonical}はクラウド共有（PINコード）経由で${BACKUP_TERMS.restoreVerb}してください`,

	// #4752 (PO 回答 2026-09-03): 置換 (復元) 失敗時に顧客へ出す 3 文言。実際のデータ状態と一致させる
	// (保全できていない状態に「保全されています」を出さない)。3 つとも error-notify の
	// sanitizeServerMessage を素通りする (日本語のみ / 内部識別子・例外クラス名を含まない) ことを
	// tests/integration/db/restore-compensation-failure-4752.test.ts が実測で固定する。
	//   - 中止 + 旧データ復元済 (旧実装は末尾に生の例外文字列を連結しており、client 側 sanitize で
	//     「入力内容をご確認ください」に落ちて保全の事実が顧客に届かなかった)
	errorReplaceAbortedPreserved:
		'インポートに失敗したため中止しました（既存データは保全されています）',
	//   - 置換前 snapshot を取れず未開始 (旧データ無傷)
	errorReplaceSnapshotFailed: '置換前のバックアップ取得に失敗したため、安全のため中止しました',
	//   - 自動復元も途中で止まった (半端な状態)。その旨 + 復旧手段 (運営連絡 + 復旧コード) を必ず出す。
	//     recoveryCode は storage の復旧用 ZIP を運営が特定するための短い参照 (tenant id や storage key
	//     そのものは出さない = info-disclosure 回避 + client sanitize の長 ID 検出に掛からない)
	errorReplaceRestoreFailed: REPLACE_RESTORE_FAILED_MESSAGE,
	errorReplaceRestoreFailedWithCode: (recoveryCode: string) =>
		`${REPLACE_RESTORE_FAILED_MESSAGE}（復旧コード: ${recoveryCode}）`,

	// 事前確認ダイアログ
	previewDialogTitle: 'インポート内容の確認',
	previewDialogConfirm: 'スキップして続行',
	previewDialogCancel: 'キャンセル',
	previewDialogDuplicatesHeading: '以下は既存と重複するためスキップされます',
	previewDialogPresetDuplicate: 'このプリセットは既にインポート済みです',
	previewDialogNameDuplicate: '名前が既存と同じため',
	previewDialogLogConstraint: '記録日時が既存と同じため',
} as const;

/**
 * スキップ理由 enum (#1254 G2)
 * - preset_duplicate: source_preset_id 一致
 * - name_duplicate: 名前一致
 * - log_constraint: 複合 unique 制約 (activity_logs, login_streaks, status_history)
 */
export type ImportSkipReason = 'preset_duplicate' | 'name_duplicate' | 'log_constraint';

// ============================================================
// 設定ページ関連ラベル（#1452 Phase B）
// ============================================================

export const SETTINGS_LABELS = {
	// #3991: `grace_period` の意味は「支払い失敗の猶予 (dunning)」に一意化された。
	// 旧文言は解約申請の猶予を指しており (#3986 の多重定義)、支払い失敗のテナントに
	// 「解約手続き中です」+ 解約取り消しボタンを見せていた。解約申請中の表示と取り消し導線は
	// `/admin/subscription` (SaasLicensePanel) が Stripe の `cancel_at_period_end` を SSOT に担う。
	gracePeriodTitle: 'お支払いを確認できていません',
	gracePeriodDesc:
		'カードの有効期限切れなどでお支払いが完了していない可能性があります。プラン・お支払い画面からお支払い方法をご確認ください。お子さまの記録はそのままご利用いただけます。',
	gracePeriodAction: 'プラン・お支払いを確認する',

	// #4699: 退会申請中に書き込み操作をして設定画面へ戻されたときの説明 (旧実装は
	// `?reason=account_deletion_pending` を誰も表示せず、無言で設定トップに飛ばしていた)
	deletionPendingReadOnlyNotice:
		'アカウント削除のお手続き中のため、設定の変更は行えません（読み取り専用）。下の「アカウント」から復元すると、これまでどおりご利用いただけます。',
	// #1781: 削除グレースピリオド（soft-delete）バナー
	deletionGraceTitle: 'アカウント削除のお手続き中です',
	// #4496: 呼び出し側 (admin/settings/account) が渡すのは `daysRemaining` (残日数) なのに、
	//   文言は「お手続きから N 日後」と経過日数として述べていたため、数日後に開くと
	//   値と説明が食い違っていた。引数名を実体に合わせ、文言も残日数として述べる。
	deletionGraceDesc: (daysRemaining: number, date: string) =>
		`あと ${daysRemaining} 日（${date}）ですべてのデータが完全に削除されます。それまでであれば「復元」ボタンで取り消せます。`,
	deletionGraceRestoreAction: 'アカウントを復元する',
	deletionGraceRestoreSubmitting: '復元中...',
	deletionGraceRestoreSuccess: 'アカウントを復元しました。通常通りご利用いただけます。',
	deletionGraceRestoreError:
		'アカウントの復元に失敗しました。猶予期間が終了している可能性があります。',

	// ステータス減少設定
	decaySectionTitle: '📊 ステータス減少設定',
	decaySectionDesc:
		'活動をお休みした日のステータス減少の強さを設定できます。どの設定でも最初の2日間は減少しません。',
	decaySaving: '保存中...',
	decaySaveAction: '設定を保存',
	decaySaved: 'ステータス減少設定を保存しました',
	// #4663 F7: 4 段階の選択肢。svelte 内の DECAY_OPTIONS に直書きされており、ガイドが
	// 同じ語を引けなかった。ラベルと説明はここが SSOT (page は本定数を参照する)。
	decayOptionNone: 'なし',
	decayOptionNoneDesc: '減少しません（練習や導入期間向け）',
	decayOptionGentle: 'ゆるやか',
	decayOptionGentleDesc: '通常の半分の速度で減少します',
	decayOptionNormal: 'ふつう',
	decayOptionNormalDesc: '猶予2日後にゆるやかに減少します',
	decayOptionStrict: 'きびしめ',
	decayOptionStrictDesc: '上級者向け。1.5倍の速度で減少します',

	// 既定の子供
	defaultChildSectionTitle: `🏠 既定の${CHILD_TERMS.honorific}`,
	// #4716: 生パス「（/）」を外す (顧客に URL を読ませない)
	defaultChildDesc: `アプリを開いたときに自動で表示する${CHILD_TERMS.honorific}を選べます。`,
	defaultChildDescNote: 'これは',
	defaultChildDescNoteStrong: 'この端末ではなく、アカウント全体の既定',
	defaultChildDescNoteSuffix: 'です。未設定のときは選択画面が表示されます。',
	defaultChildUpdated: `既定の${CHILD_TERMS.honorific}を更新しました`,
	defaultChildNone: '未設定（毎回選択画面を表示）',
	defaultChildSaveAction: '既定を保存',

	// きょうだいチャレンジ設定
	siblingSectionTitle: '👥 きょうだいチャレンジ設定',
	siblingSaved: 'きょうだい設定を保存しました',
	siblingRankingLabel: 'きょうだいランキングを表示する',
	// #1960 Phase 7 H3: terms.ts atom 参照化
	siblingRankingUpsell: `きょうだいランキングは${PLAN_FULL_TERMS.premium}限定の機能です。`,
	siblingRankingUpsellLink: 'プランのアップグレード',
	siblingRankingUpsellSuffix: 'で利用できます。',
	siblingSaveAction: '設定を保存',

	// 通知設定
	notificationSectionTitle: '🔔 通知設定',
	notificationSaved: '通知設定を保存しました',
	notificationBrowserLabel: 'ブラウザ通知',
	notificationChecking: '確認中...',
	notificationEnableAction: '通知をオンにする',
	notificationEnableActionLoading: 'オンにしています…',
	notificationDisableAction: '通知をオフにする',
	// #3186: 通知ステータス UI の文言 SSOT 化。内部状態 (許可済み未登録 等) は出さず
	// ユーザ向けは ON / OFF + 異常系 (ブロック / 非対応) に集約する。
	notificationStatusOn: 'オン',
	notificationStatusBlocked: 'ブロック中',
	notificationUnsupportedNote: 'お使いのブラウザ・端末では通知を使えません',
	notificationBlockedNote: 'ブラウザのサイト設定で通知を許可してください',
	notificationEnableSuccess: '通知をオンにしました',
	notificationEnableFailure: '通知をオンにできませんでした。時間をおいて再度お試しください',
	notificationDisableSuccess: '通知をオフにしました',
	notificationDisableFailure: '通知をオフにできませんでした。時間をおいて再度お試しください',
	notificationReminderLabel: 'リマインダー通知（毎日の記録を促す）',
	// #4664 F8: リマインダー時刻の見出しが svelte 直書きで、ガイドから同じ語を引けなかった。
	notificationReminderTimeLabel: 'リマインダー時刻',
	notificationStreakLabel: 'ストリーク警告（連続記録が途切れそうな時）',
	notificationAchievementLabel: '達成通知（記録完了・レベルアップ時）',
	notificationQuietSeparator: '〜',
	notificationSaveAction: '通知設定を保存',
	// #4664 F8: サイレント時間帯の見出し / 補足が svelte 直書きで、ガイドから同じ語を
	//   引けなかった (DESIGN.md §6 逸脱)。
	notificationQuietLabel: 'サイレント時間帯',
	notificationQuietHint: 'この時間帯は通知を送信しません',
	// #4664 F3: 1 日の上限は notification-service.ts の MAX_DAILY_NOTIFICATIONS が値 SSOT。
	notificationDailyLimitHint: (max: number) => `お知らせは 1 日 ${max} 件までです`,
	// #4512: settings/notifications の時刻入力の検証エラー文言。
	notificationTimeFormatInvalid: '時刻の形式が不正です',

	// ポイント表示設定
	pointSectionTitle: '💰 ポイント表示設定',
	pointSaved: 'ポイント表示設定を保存しました',
	pointDisplayMode: '表示モード',
	pointModePoint: 'ポイント（P）',
	pointModeCurrency: '通貨で表示',
	pointPreviewLabel: (n: number) => `プレビュー（${n}P の場合）`,
	// #4663 F7: 通貨モードの追加入力欄。svelte に直書きされており、ガイドから同じ語を
	// 引けなかった (DESIGN.md §6 逸脱)。
	// #4512: 「通貨」は CURRENCY_TERMS atom に集約し、検証エラー文言もここへ寄せた。
	pointCurrencyLabel: `${CURRENCY_TERMS.canonical}`,
	pointRateLabel: (symbol: string) => `レート（1P = ？${symbol}）`,
	pointRateHint: '例: 1P = 1円なら「1」、1P = 0.01ドルなら「0.01」',
	// #4512: 活動・ポイント設定 (settings/activities) の form action 検証エラー (旧: server 直書き)。
	pointModeInvalid: 'モードが不正です',
	pointCurrencyInvalid: `${CURRENCY_TERMS.canonical}コードが不正です`,
	pointRateRange: 'レートは0より大きく10000以下で入力してください',
	defaultChildIdInvalid: `${CHILD_TERMS.honorific}の ID が不正です`,
	defaultChildNotFound: `指定された${CHILD_TERMS.honorific}が見つかりません`,
	// #4512: ステータス減少強度 (DECAY_OPTIONS) のラベル / 説明は #4663 F7 が
	// decayOptionNone / .decayOptionNoneDesc … として先に集約済みのため、
	// merge 時に重複定義 (decayOption*Label) を削除しそちらに寄せた。
	pointSaveAction: 'ポイント設定を保存',

	// データ管理 (#backup-terms: 内部フォーマット JSON/ZIP は UI 露出しない。BACKUP_TERMS 統一)
	dataSectionTitle: '💾 データ管理',
	dataExportDesc: `家族のデータを${BACKUP_TERMS.file}としてダウンロードできます。${BACKUP_TERMS.exportNoun}や別環境への移行に使用できます。`,
	dataExportTarget: `${BACKUP_TERMS.canonical}に含まれるもの:`,
	dataExportItem1: `${CHILD_TERMS.honorific}プロフィール・活動記録・ポイント履歴`,
	dataExportItem2: 'ステータス・実績・称号・ログインボーナス',
	// #4716: 「誕生日振り返り」は export にも UI にも無い機能名だった
	dataExportItem3: 'チェックリスト・おやくそく設定',
	dataExportItem4: '活動マスタ・きせかえアイテム',
	dataExportUpsellTitle: `🔒 データの${BACKUP_TERMS.exportNoun}は `,
	// #1960 Phase 7 H3: terms.ts atom 参照化
	dataExportUpsellPlan: `${PLAN_FULL_TERMS.standard}`,
	dataExportUpsellSuffix: ' 以上でご利用いただけます。',
	dataExportUpsellDesc: `家族のデータを${BACKUP_TERMS.file}としてダウンロードして、${BACKUP_TERMS.exportNoun}や引っ越しに利用できます。`,
	dataExportUpsellCta: 'プランを見る',
	dataExportLockedButton: `🔒 ${BACKUP_TERMS.canonical}をダウンロード（有料プラン限定）`,
	dataExportIncludeFiles: '画像・音声ファイルも含める',
	dataExportIncludeFilesHint:
		'画像・音声を含める場合は上のチェックをオンにしてください。ファイルサイズが大きくなる場合があります（最大100MB）。',
	// #3376 fail-closed: 同梱対象 (data.json + 画像・音声) の合計が上限を超えたとき、
	// 不完全な部分バックアップを黙って作らず明示エラーにする (再生成不能な avatar/voice の silent 欠落防止)。
	dataExportTooLarge: (maxMb: string) =>
		`バックアップ対象のデータが上限（${maxMb}MB）を超えています。不要な画像・音声を整理してから、もう一度お試しください。`,
	// #3405-3: 個々の画像・音声ファイル単体が per-entry 上限を超えたとき、build/parse 対称化のため
	// build 時点で明示エラーにする (25MB 超 entry を含む ZIP を作らせない = import で silent drop →
	// 復元不能になる dead-end を根治)。
	dataExportEntryTooLarge: (maxMb: string) =>
		`1つの画像・音声ファイルが上限（${maxMb}MB）を超えています。該当ファイルを小さくするか削除してから、もう一度お試しください。`,
	// #3694: AWS 本番の Function URL (BUFFERED) は response も 6MB hard cap。画像込み ZIP が
	// 直接ダウンロードの実効上限を超えると edge で沈黙切断されるため、明示エラー + クラウド共有
	// (PINコード、非同期・上限なし) への誘導を返す (ADR-0062)。
	dataExportTooLargeForDirectDownload: (maxMb: string) =>
		`画像・音声を含むファイルが直接ダウンロードの上限（${maxMb}MB）を超えています。「クラウド共有（PINコード）」から${BACKUP_TERMS.exportVerb}してください`,
	// #3775 ①: JSON export (テキストのみ、画像・音声は ZIP 同梱) も aws-prod では Function URL
	// 6MB response cap を超えると edge 沈黙切断される。JSON は画像・音声を含まないため専用文言で
	// クラウド共有 (PINコード、非同期・上限なし) へ誘導する (ADR-0062 / dataExportTooLargeForDirectDownload と対)。
	dataExportJsonTooLargeForDirectDownload: (maxMb: string) =>
		`${BACKUP_TERMS.canonical}が直接ダウンロードの上限（${maxMb}MB）を超えています。「クラウド共有（PINコード）」から${BACKUP_TERMS.exportVerb}してください`,
	// #3376: 画像込み ZIP ダウンロードはブラウザの安全性警告（保存の確認）が出ることがある。
	// 画像込みの完全バックアップは、警告の出ないクラウドバックアップを推奨する導線（SaaS 版専用）。
	dataExportZipCloudHint:
		'画像・音声を含むファイルのダウンロードは、ブラウザが安全性の確認を求めることがあります（壊れたファイルではありません）。画像も含めて安全に残すなら、下の「クラウド共有」がおすすめです。',
	// #3867: セルフホスト版（authMode≠cognito）はクラウドバックアップ導線が無いため、
	// 「クラウドバックアップ」に言及しない代替文言。ブラウザ安全性警告は正常である旨の安心情報のみ残す
	// （下にクラウドセクションが無いのに「下のクラウドバックアップがおすすめ」と案内する dangling を防ぐ）。
	dataExportZipLocalHint:
		'画像・音声を含むファイルのダウンロードは、ブラウザが安全性の確認を求めることがあります（壊れたファイルではありません）。そのまま保存していただいて問題ありません。',
	dataExportCompact: 'ファイルサイズを小さくする（圧縮）',
	dataExporting: '書き出し中...',
	dataExportAction: `${BACKUP_TERMS.canonical}をダウンロード`,

	// インポート
	// #4716: 「インポート」= 復元。BACKUP_TERMS の語 (バックアップ / 復元) に統一する。
	dataImportTitle: `${BACKUP_TERMS.canonical}から${BACKUP_TERMS.restoreVerb}`,
	dataImportDesc: `保存した${BACKUP_TERMS.file}からデータを${BACKUP_TERMS.restoreVerb}できます（画像・音声を含むファイルはアバター画像・音声も${BACKUP_TERMS.restoreVerb}します）。`,
	dataImportMode: `${BACKUP_TERMS.restoreVerb}のしかた`,
	// #4690 (QM): ページガイドが引用する選択肢名なので atom を SSOT にする
	// (片方だけ変えるとガイドが存在しない選択肢を指す)。
	dataImportModeReplace: BACKUP_TERMS.importModeReplace,
	dataImportModeAdd: BACKUP_TERMS.importModeAdd,
	dataImportModeReplaceWarning: `既存の${CHILD_TERMS.honorific}・活動ログ・ポイント等のデータをすべて削除してから${BACKUP_TERMS.restoreVerb}します。`,
	dataImportModeAddNote: `新しい${CHILD_TERMS.honorific}データとして追加されます（既存データは上書きされません）。`,
	dataImportLoading: '読み込み中...',
	dataImportSelectFile: `${BACKUP_TERMS.file}を選択`,
	// #backup-terms: 不正ファイル選択時 (内部フォーマット名は出さず「バックアップファイル」で統一)
	dataImportInvalidFile: `${BACKUP_TERMS.file}を選択してください`,
	// #3285 uiux-3: settings/data の import 検証 / クラウド連携メッセージを SSOT 集約 (旧: 直書き)
	dataImportNoFile: `${BACKUP_TERMS.file}が選択されていません`,
	dataImportFileTooLarge: (maxMb: string) => `ファイルサイズが大きすぎます（最大${maxMb}MB）`,
	// #3324: import fetch の client timeout (AbortController) 発火時の明示エラー (無限ハング防止)
	dataImportTimeoutError:
		'処理がタイムアウトしました。通信状況をご確認のうえ、しばらくしてから再度お試しください',
	// #3372: registry (backup-entity-registry) 駆動の partial-backup 警告 (NN/G visibility)。
	// 未 export の source 実体が存在する間のみ表示し、export 実装が進むと自動で消える。
	dataImportPartialBackupWarning: (items: string) =>
		`この${BACKUP_TERMS.exportNoun}形式にはまだ含まれないデータがあります（${items}）。これらは${BACKUP_TERMS.restoreVerb}されません。`,
	cloudExportPinIssued: (pinCode: string, expiry: string) =>
		`PINコード: ${pinCode}（有効期限: ${expiry}）`,
	cloudImportNoChildren: `取込先の${CHILD_TERMS.honorific}が登録されていません。先に${ADMIN_SCREENS.children.name}で登録をしてください。`,
	dataImportChecksumOk: '✓ ファイルの整合性を確認しました',
	dataImportPreviewChildren: (n: number | string | undefined) => `${CHILD_TERMS.honorific}: ${n}人`,
	dataImportPreviewActivityLogs: (n: number | string | undefined) => `活動ログ: ${n}件`,
	dataImportPreviewPointLedger: (n: number | string | undefined) => `ポイント履歴: ${n}件`,
	dataImportPreviewStatuses: (n: number | string | undefined) => `ステータス: ${n}件`,
	dataImportPreviewAchievements: (n: number | string | undefined) => `実績: ${n}件`,
	dataImportPreviewLoginBonuses: (n: number | string | undefined) => `ログインボーナス: ${n}件`,
	dataImportPreviewChecklists: (n: number | string | undefined) => `チェックリスト: ${n}件`,
	// #4696: データクリアの件数表示 (お子さまの音声)。実績 (#322 廃止) は表示対象から外した
	dataImportPreviewVoices: (n: number | string | undefined) => `お子さまの音声: ${n}件`,
	dataImportMoreItems: (n: number) => `...他 ${n}件`,
	dataImportReplaceConfirm:
		'既存データをすべて削除してからインポートします。この操作は取り消せません。',
	dataImportAddConfirm: `インポートすると新しい${CHILD_TERMS.honorific}データとして追加されます。この操作は取り消せません。`,
	dataImportCancel: 'キャンセル',
	dataImporting: 'インポート中...',
	dataImportAction: 'インポートを実行',
	dataImportComplete: 'インポート完了',
	dataImportResultChildren: (n: number | string) => `${CHILD_TERMS.honorific}: ${n}人 作成`,
	dataImportResultActivities: (n: number | string) => `活動マスタ: ${n}件 新規作成`,
	/**
	 * 復元がプラン上限で一部を保管したときの結果行 (#4693)。
	 * **文面の SSOT は `ACTIVITY_QUOTA_LABELS.restoreArchivedResult`** — marketplace 経由の復元
	 * (活動管理の ︙ →「バックアップから復元」) と同じ文言を出すため、ここでは委譲だけする。
	 */
	dataImportResultQuotaArchived: ACTIVITY_QUOTA_LABELS.restoreArchivedResult,
	dataImportResultActivityLogs: (imported: number | string, skipped: number | string) =>
		`活動ログ: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultPointLedger: (imported: number | string, skipped: number | string) =>
		`ポイント: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	// #3095: silent-skip 可視化 — 静的ファイル / チェックリスト履歴 / ごほうび の復元・skip 件数を surface
	dataImportResultSpecialRewards: (imported: number | string, skipped: number | string) =>
		`ごほうび: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultChecklistLogs: (imported: number | string, skipped: number | string) =>
		`チェックリスト履歴: ${imported}件${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultStaticFiles: (restored: number | string, skipped: number | string) =>
		`画像・音声ファイル: ${restored}件復元${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	// #3490: childVoices (お子さまの音声) / 各種設定の復元・skip 件数を summary に surface (silent-skip 可視化)
	dataImportResultChildVoices: (imported: number | string, skipped: number | string) =>
		`お子さまの音声: ${imported}件復元${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportResultSettings: (imported: number | string, skipped: number | string) =>
		`各種設定: ${imported}件復元${Number(skipped) > 0 ? `（${skipped}件スキップ）` : ''}`,
	dataImportWarningsTitle: (n: number | string) => `警告 (${n}件):`,
	dataImportErrorsTitle: (n: number | string) => `エラー (${n}件):`,
	// #3095: partial-restore の data-integrity 可視化 — errors があれば「完了」でなく部分復元として警告する。
	// とくに置換 (replace) は既存データをクリア後に復元するため、部分失敗が成功扱いになると家族データが半損する。
	dataImportPartialTitle: '一部のデータを復元できませんでした',
	dataImportPartialBodyReplace:
		'既存データはクリア済みのため、復元できなかった項目は失われています。下記の内容をご確認のうえ、バックアップから再度インポートしてください。',
	dataImportPartialBodyAdd:
		'復元できなかった項目があります。下記の内容をご確認のうえ、必要に応じて再度インポートしてください。',
	dataImportClose: '閉じる',
	// #3386: バックアップ ZIP の整合性検証失敗メッセージ (ADR-0062 — 内部 reason コード / 生パスを露出しない
	// ユーザー向け文言。内部 reason は logger のみに残す)。checksum/size/missing 破損は共通の破損文言で、
	// unexpected-file (混入) のみ別文言にして「作り直し」の次アクションを促す。
	dataImportManifestCorrupt:
		'バックアップファイルが壊れているため復元できません。もう一度エクスポートしてください',
	dataImportBackupCorrupt:
		'バックアップファイルの内容が壊れているため復元できません。もう一度エクスポートしてください',
	dataImportBackupUnexpectedFile:
		'バックアップファイルに想定外のデータが含まれているため復元できません。もう一度エクスポートしてください',
	dataImportBackupCountMismatch:
		'バックアップファイルの一部が欠けているため復元できません。もう一度エクスポートしてください',

	// クラウドエクスポート
	cloudSectionTitle: '☁️ クラウド共有',
	cloudSlotCounter: (current: number, max: number) => `保管枠 ${current} / ${max}`,
	cloudUpsellTitle: '🔒 クラウド共有は ',
	// #1960 Phase 7 H3: terms.ts atom 参照化
	cloudUpsellPlan: `${PLAN_FULL_TERMS.standard}`,
	cloudUpsellSuffix: ' 以上でご利用いただけます。',
	cloudUpsellDesc: `家族のデータをクラウドに保管して、PINコードで別端末や他のアカウントと共有できます（${PLAN_TERMS.standard}: 3枠 / ${PLAN_TERMS.premium}: 10枠）。`,
	cloudUpsellCta: 'プランを見る',
	cloudExportDesc: '設定やデータをクラウドに保管してPINコードで他のアカウントと共有できます。',
	cloudExportType: 'エクスポートタイプ',
	cloudExportTypeTemplate: 'テンプレート（活動・チェックリスト）',
	cloudExportTypeFull: 'フルバックアップ',
	cloudExportTypeTemplateDesc: '活動設定やチェックリストのみ共有します（個人データは含みません）。',
	cloudExportTypeFullDesc: `${CHILD_TERMS.honorific}データ・活動ログ等すべてのデータを含みます。環境移行用です。`,
	cloudSaving: '保管中...',
	cloudSaveAction: 'クラウドに保管',
	cloudStoredTitle: '保管済みデータ',
	cloudStoredDownloads: (count: number | string, max: number | string) => `DL: ${count}/${max}回`,
	cloudStoredDelete: '削除',
	// #4767 QM should: 期限 (絶対日付) は状態によらず常に出す。「あと N 日」だけだと
	// いつ消えるのかが読み手の暦計算に依存し、状態表示の分岐で欠けやすい。
	cloudStoredExpiry: (date: string) => `期限: ${date}`,
	// #4767 QM must: 削除は S3 の全バージョンを消す取り消し不能な操作。押した瞬間に実行せず、
	// 何が消えるのか (PIN / 種別 / 状態) と「元に戻せない」ことを confirm dialog で名指しする。
	cloudDeleteConfirmTitle: 'この共有データを削除しますか？',
	cloudDeleteConfirmTarget: (pinCode: string, type: string, state: string) =>
		`削除するもの: PIN ${pinCode}（${type}・${state}）`,
	cloudDeleteConfirmIrreversible:
		'削除すると保管データも共有リンクも完全に消え、元に戻せません。受け取る側がまだ取り込んでいない場合は取り込めなくなります。',
	cloudDeleteConfirmQuotaNote: '削除すると保管枠はすぐに空きます。',
	// #4867 (PO 決裁 2026-09-09): **PIN の再発行という操作は作らない**。削除がそのまま
	//   失効の手段である (削除で DB 行が消え、`fetchCloudExportByPin` は DB を引くので
	//   旧 PIN はその瞬間に無効になる)。足りていなかったのは機能ではなく、
	//   「PIN を人に見られたとき何をすればいいか」が顧客に伝わっていないことだった。
	//   **順序を「削除 → 作り直し」で案内する** — 先に新しいものを作ると、旧 PIN が
	//   生きている時間が伸びる。
	cloudPinLeakedGuidance:
		'PIN を知られてしまったときは、削除するとすぐに使えなくなります。あらためて共有を作り直してください。',
	cloudDeleteConfirmExecute: '削除する',
	cloudDeleteConfirmCancel: 'やめる',
	// #4767 QM should: S3 の削除に失敗したときは黙って DB だけ消さない (顧客に見せて再試行させる)。
	// #4867 adversarial: 削除は #4767 で fail-closed (S3 削除に失敗したら DB 行を残す) なので、
	//   失敗した時点では **PIN はまだ失効していない**。一覧の案内は「削除すればすぐ使えなくなる」
	//   と無条件に言うため、失敗時にそれが成立していないことを伝えないと、
	//   顧客は「消したから安全」と誤解したまま漏れた PIN を放置する。
	cloudDeleteFailed:
		'削除できませんでした。データは残っており、この PIN はまだ使える状態です。時間をおいてもう一度お試しください。',
	cloudStoredDeleting: '削除中…',
	// #4767 QM should: 取り消せない操作の完了を無言で終わらせない (行が消えるだけ = 何が起きたか不明)。
	// Toast (role="alert") + 画面内 banner (role="status") の 2 層で、**何を消したか**を名指しする。
	cloudDeleteSuccessTitle: '削除しました',
	cloudDeleteSuccess: (pinCode: string) =>
		`PIN ${pinCode} の共有データを削除しました。保管枠が 1 つ空きました。`,
	// #4767 QM should: 削除は成功したが一覧の再取得に失敗した場合。成功と言い切ると、
	// 画面に残った古い行を見た顧客が「消えていない」と受け取る (実際は消えている)。
	// 起きたこと (削除は成功) と、いま見えているものの信頼度 (古いかもしれない) を分けて言う。
	cloudDeleteSuccessStaleTitle: '削除しましたが一覧を更新できませんでした',
	cloudDeleteSuccessStale: (pinCode: string) =>
		`PIN ${pinCode} の共有データは削除しました。ただし一覧の再取得に失敗したため、下の表示が最新でない可能性があります。画面を再読み込みしてご確認ください。`,
	// #4767: 削除しようとした行が既に無い (別端末で削除済 / 期限切れ cleanup 済) ときの案内。
	// 「見つかりません」を route が文字列一致で 404 に写像していたのを型で運ぶようにした際の SSOT。
	cloudDeleteAlreadyGone:
		'このデータは既に削除されています。画面を更新すると最新の状態になります。',
	// #4767 PO 回答 #3: 枠を占有している全行を状態付きで見せる。
	// 状態名は PO 回答の 4 語 (ダウンロード可能 / ダウンロード回数を使い切りました / 作成に失敗しました /
	// あと N 日で自動削除) をそのまま使う。生成待ち / 生成中は既存 cloudStatusPending / cloudStatusBuilding。
	cloudRowStateDownloadable: 'ダウンロード可能',
	cloudRowStateExhausted: 'ダウンロード回数を使い切りました',
	cloudRowStateFailed: '作成に失敗しました',
	cloudAutoDeleteIn: (days: number) => `あと${days}日で自動削除`,
	cloudStoredCreated: (date: string) => `${date} 作成`,
	// 上限到達 403 で名指しする 1 件分: "ABC123（ダウンロード回数を使い切りました・2026/08/28 作成）"
	cloudDeleteCandidate: (pinCode: string, state: string, created: string) =>
		`${pinCode}（${state}・${created}）`,
	cloudStoredListDesc:
		'ここに並ぶデータはすべて保管枠を使っています。不要なものは削除すると枠がすぐに空きます。',
	// #3324 / #3509: 非同期 build 状態 (pending/building/ready/failed) の可視フィードバック
	cloudStatusPending: '受付済み・生成待ち',
	cloudStatusBuilding: '生成中…',
	cloudStatusFailed: (reason: string) => `作成に失敗しました${reason ? `（${reason}）` : ''}`,
	// #4867 adversarial round 7: build 失敗の既定文言。**サーバの例外 message を親の画面に
	//   出さない** (ADR-0062 §2)。旧実装は `err.message` をそのまま `failure_reason` に保存し、
	//   NUC の local FS backend では errno + サーバの絶対パス + tenant id が親に見えていた
	//   (PIN は伏せていたが、伏せたのは PIN だけ)。#3376 のコメントは元から
	//   「その他は generic なエラーメッセージを残す」と書いてあり、**コードがそれに反していた**。
	//   原因の詳細は logger.error 側に (伏せたうえで) 残す。
	//   **文言は `cloudStatusFailed` の括弧の中に入る**ので、文として完結させない
	//   (round 8 実測: 「保管データの作成に失敗しました。もう一度お試しください。」を渡すと
	//    `作成に失敗しました（保管データの作成に失敗しました。もう一度お試しください。）` と
	//    **同じ句が 1 行に 2 回**出ていた)。
	cloudBuildFailedDefault: 'もう一度お試しください',
	//   NUC (自宅サーバ) では**親が運用者**なので、自分で直せる失敗は名指しする
	//   (round 8 指摘。generic に潰すと、容量を空ければ直る人が何度も再試行するだけになる)。
	cloudBuildFailedNoSpace: '保存先の空き容量が足りません。空きを作ってからお試しください',
	cloudBuildFailedPermission: '保存先に書き込めませんでした。保存先の設定をご確認ください',
	cloudDownloadAction: 'ダウンロード',
	// #4717: 発行直後 (pending/building) / 失敗 (failed) の PIN で取り込もうとしたときの案内。
	// 「システムに問題が発生しました」(500) ではなく、待てば解決することを伝える。
	cloudImportNotReady: 'このデータはまだ準備中です。数分後にもう一度お試しください。',
	cloudImportBuildFailed:
		'このデータの作成に失敗しています。共有した方にもう一度クラウドへ保管しなおしてもらってください。',
	cloudImportTitle: 'PINコードでインポート',
	cloudImportDesc: '共有されたPINコードを入力してデータを取り込みます。',
	cloudImportPinPlaceholder: 'PINコード（6桁）',
	cloudImportChecking: '確認中...',
	cloudImportConfirmAction: '確認',
	cloudImportPreviewTitle: 'インポート内容の確認',
	cloudImportPreviewActivities: (n: number | string | unknown) => `活動マスタ: ${n}件`,
	cloudImportPreviewChecklists: (n: number | string | unknown) => `チェックリスト: ${n}件`,
	cloudImportTemplateNote: '既存の設定に追加されます（重複はスキップ）。',
	cloudImportFullNote: 'フルバックアップデータです。追加インポートされます。',
	cloudImportCancel: 'キャンセル',
	cloudImporting: 'インポート中...',
	cloudImportAction: 'インポート実行',
	cloudImportComplete: 'インポート完了',
	cloudImportResultActivities: (n: number | string | unknown) => `活動マスタ: ${n}件 追加`,
	cloudImportResultChecklists: (n: number | string | unknown) => `チェックリスト: ${n}件 追加`,
	cloudImportResultChildren: (n: number | string | unknown) =>
		`${CHILD_TERMS.honorific}データ: ${n}人 追加`,
	cloudImportClose: '閉じる',

	// データクリア
	// #4716: 「データクリア」は内部語。実行内容 (すべてのデータを削除) をそのまま名乗る。
	clearSectionTitle: `🗑️ ${BACKUP_TERMS.clearAll}`,
	clearDesc: `すべての家族データ（${CHILD_TERMS.honorific}・活動ログ・ポイント・ステータス等）を一括削除します。活動マスタ・カテゴリなどのシステムデータは保持されます。`,
	clearCurrentDataTitle: '現在のデータ件数',
	clearIrreversibleWarning: `この操作は取り消せません。事前に${BACKUP_TERMS.exportVerb}ことをお勧めします。`,
	clearCompleted: `${BACKUP_TERMS.clearAll}が完了しました。ページを再読み込みしてください。`,

	// フィードバック (#support-unify: 1 フォーム統合 — intent 2 軸 + 内容分類併用。研究: 単一フォーム + intent セレクタ)
	feedbackSectionTitle: '💬 サポート・ご意見',
	feedbackSectionDesc:
		'個人開発のため、開発者本人がひとつずつ目を通します。ご感想・ご要望も、導入や使い方・解約のご相談もこちらからどうぞ。',
	feedbackIntentLabel: 'ご用件',
	feedbackIntentFeedback: '感想・要望を送る（返信は不要）',
	feedbackIntentConsult: '相談・困りごと（返信を希望）',
	feedbackCategoryLabel: '種類',
	feedbackCategoryFeature: '機能要望',
	feedbackCategoryBug: 'バグ報告',
	feedbackCategoryOther: 'その他',
	feedbackChildAgeLabel: 'お子さまの年齢（任意）',
	feedbackChildAgePlaceholder: '例: 7 歳、3 歳と 6 歳など',
	feedbackChildAgeHint: 'お子さまに合うかどうかをご一緒に考えるための参考にします。',
	feedbackReplyEmailLabel: '返信先メールアドレス',
	feedbackReplyEmailOptionalSuffix: '（任意）',
	feedbackReplyHintFeedback: '読ませていただきますが、個別の返信はできない場合があります。',
	feedbackReplyHintConsultWithAccount: (account: string) =>
		`${account} に返信します（通常 1〜2 日以内）。別のアドレスを希望する場合は入力してください。`,
	feedbackReplyHintConsultNoAccount:
		'返信のためメールアドレスを入力してください（通常 1〜2 日以内）。',
	feedbackConsultReplyRequiredError: '相談・困りごとは返信先メールアドレスを入力してください',
	feedbackInvalidIntentError: 'ご用件の選択が不正です',
	// #4512: 旧実装は上 2 つの error label を定義しながら +page.server.ts 側で同じ文字列を
	// 直書きしており (二重定義)、残りの validation メッセージも server にしか無かった。
	feedbackContentRequiredError: '内容を入力してください',
	feedbackContentTooLongError: '1000文字以内で入力してください',
	feedbackInvalidCategoryError: 'カテゴリが不正です',
	feedbackInvalidEmailError: 'メールアドレスの形式が正しくありません',
	feedbackChildAgeTooLongError: 'お子さまの年齢は100文字以内で入力してください',
	feedbackSendFailedError: '送信に失敗しました。お手数ですが時間をおいて再度お試しください',
	/** 問い合わせ本文に付記する年齢の見出し (Discord / 問い合わせレコード向け) */
	feedbackChildAgeBodyPrefix: (childAge: string) => `【お子さまの年齢】${childAge}`,
	/** 通知本文で使う分類名 (intent=consult は「（返信を希望）」を含まない短い形) */
	feedbackCategoryConsult: '相談・困りごと',
	feedbackSubmitButton: '送信する',
	feedbackSubmittingText: '送信中...',
	feedbackSuccessConsult: (inquiryId: string) =>
		`ご相談を受け付けました。受付番号: ${inquiryId}。内容を確認のうえ、入力いただいたメールアドレスにご返信します。`,
	feedbackSuccessFeedbackWithId: (inquiryId: string) =>
		`お問い合わせを受け付けました。受付番号: ${inquiryId}。`,
	feedbackSuccessFeedbackEmailNote: '入力いただいたメールアドレスに確認メールをお送りしました。',
	feedbackSuccessFeedbackNoId: 'お問い合わせありがとうございます。今後の参考とさせていただきます。',
	feedbackContentLabel: '内容',
	feedbackContentPlaceholder: 'ご意見・ご要望をお聞かせください...',
	feedbackContactNote: '技術的なご質問・使い方の相談は',
	feedbackContactLinkLabel: 'メール',
	feedbackContactSuffix: 'でも受け付けています',

	// アプリ情報
	// #4087 (E3 / EPIC #4119): バックアップ状態を**家族 (非エンジニア) が見られる場所**に出す。
	// 2026-07-31 の実害では、バックアップが 18 日止まっていたのに気づく手段が
	// `curl /api/health | jq` しかなかった。ADR-0012 整合で常時表示の煽りにはせず、
	// 設定画面内の静的表示に留める (子供画面には一切出さない)。
	backupSectionTitle: '🗄️ バックアップの状態',
	backupOkTitle: '正常に取れています',
	backupWarnTitle: '確認してください',
	backupCriticalTitle: 'バックアップが取れていません',
	backupLastSuccessLabel: '最後に成功した日時: ',
	backupNeverSucceeded: '一度も成功していません',
	backupConsecutiveFailuresLabel: '連続で失敗した回数: ',
	backupNotificationMissing:
		'失敗しても通知が届かない設定です。いま止まっても気づけません (DISCORD_ALERT_WEBHOOK_URL 未設定)。',
	// #4667 F6: 実 DOM ではフォームがこのカードより **上** にあるため、方向語が誤っていた。
	backupActionHint: 'うまくいっていないときは、上のフォームから相談してください。',
	// #4162: ローテーション保留だけが起きている状態の案内。
	// **「取れていない」ではなく「片付いていない」**であることが伝わる文言にする。
	// 汎用の backupActionHint (相談してください) だけだと、必要な行動が分からないまま
	// 「job が壊れた」と読まれ、再起動や再インストールに向かってしまう。
	// #4162 昇格時 (rotation-blocked-critical) の見出し。
	// **`backupCriticalTitle`（「バックアップが取れていません」）を使ってはいけない** —
	// この状態では毎晩正常に取れており、世代はむしろ増え続けている。断定形で「取れていない」と
	// 出すと、#4162 が直したはずの「診断が真逆」を条件付きで作り直すことになる (同 class 3 回目)。
	backupRotationBlockedCriticalTitle: '急いで片づけてください',
	backupRotationBlockedHint:
		'バックアップは取れていますが、古い控えが増えすぎたため、自動での削除を止めています。古い控えを別の場所へ移してから、いらないものを消してください。',
	// 昇格後 (7 晩放置) の本文。取れている事実は変えずに、放置の危険だけを足す。
	backupRotationBlockedCriticalHint:
		'バックアップは取れていますが、古い控えが増えすぎた状態が 1 週間以上続いています。このままでは保存する場所がなくなり、いずれ本当に取れなくなります。古い控えを別の場所へ移してから、いらないものを消してください。',
	appInfoSectionTitle: 'ℹ️ アプリ情報',
	appInfoTermsLink: '📄 利用規約',
	appInfoPrivacyLink: '🔒 プライバシーポリシー',
	appInfoContactLink: '💬 お問い合わせ',
	appInfoGithubLink: '🐙 GitHub',
	appInfoVersionLabel: 'バージョン: ',

	// アカウント削除
	accountDeleteSectionTitle: 'アカウント削除',
	accountDeleteOwnerDesc:
		'オーナーとしてアカウントを削除すると、家族グループ全体のデータが影響を受けます。',
	accountDeleteOwnerItem1: `${CHILD_TERMS.honorific}のプロフィール・活動記録・ポイント履歴`,
	accountDeleteOwnerItem2: 'アバター画像・音声ファイル',
	// #4716: 「キャリアプラン」は存在しない機能名だった
	accountDeleteOwnerItem3: '設定・チェックリスト・おやくそく設定',
	accountDeleteOwnerItem4: 'メンバーシップ・招待情報',
	// #4496: 猶予の有無はプランで異なる (無料は 0 日 = 申請と同時に削除) ため、本文で猶予に
	//   言及しない。プラン別の事実は accountDeleteGraceNotice が述べる (直下に並ぶので、
	//   ここで「猶予期間の経過後は」と書くと無料プランの案内と正面から矛盾する)。
	accountDeleteOwnerWarning:
		'削除が確定するとデータは復旧できません。事前にデータをエクスポートすることを強くお勧めします。',
	// #4496: 退会 (アカウント削除) の猶予はプラン別 (無料は 0 日 = 申請と同時に物理削除)。
	//   「削除後の復旧はできません」だけでは、同一画面の復元バナー (deletionGraceDesc) や
	//   削除予告メールと矛盾し、無料プランの顧客は取り消せないことを知らないまま申し込む。
	//   手続き**前**にプラン別の猶予を述べる。日数は DELETION_GRACE_TERMS (値 SSOT) から引く。
	accountDeleteGraceNotice: (graceDays: number) =>
		graceDays === 0
			? `ご利用中の${PLAN_FULL_TERMS.free}には猶予期間がありません。お申し込みと同時にすべてのデータが完全に削除され、取り消しはできません。必要なデータは事前に持ち出してください。`
			: `お申し込みから ${graceDays} 日間は「復元」ボタンで取り消せます。${graceDays} 日を過ぎるとすべてのデータが完全に削除され、復旧できません。`,
	accountDeleteChildDesc: 'アカウントを削除すると、あなたのログイン情報が削除されます。',
	accountDeleteChildDesc2:
		'活動記録やポイントは家族グループに残りますが、このアカウントでのログインはできなくなります。',
	accountDeleteChildWarning: '削除後の復旧はできません。',
	accountDeleteMemberDesc:
		'アカウントを削除すると、家族グループから離脱し、ログイン情報が削除されます。',
	accountDeleteMemberDesc2: '家族グループのデータは引き続き保持されます。',
	accountDeleteMemberWarning: '削除後の復旧はできません。',
	accountDeleteTransferTitle: '家族グループに他のメンバーがいます',
	accountDeleteTransferDesc:
		'オーナー権限を別のメンバーに移譲するか、家族グループを全て削除するか選択してください。',
	accountDeleteTransferOption: `オーナー権限を移譲して${CANCEL_TERMS.account}する`,
	accountDeleteFullOption: '家族グループを全て削除する',
	accountDeleteFullOptionDesc: '全メンバーの所属が解除され、全データが削除されます。',
	accountDeleteCancelAction: 'キャンセル',
	// #4640: 他が子供だけの家族グループでは、オーナーを渡せる相手が居ない。
	// 空の移譲欄を出して選ばせようとすると退会そのものができなくなるため、
	// 移譲欄を出さず「なぜ渡せないか」と「残る選択肢」を述べる。
	accountDeleteNoAdultTitle: '家族グループに他のメンバーがいます',
	accountDeleteNoAdultDesc: `いま家族グループにいるのは${CHILD_TERMS.honorific}だけです。${CHILD_TERMS.honorific}にオーナーを引き継ぐことはできないため、この家族グループを全て削除して${CANCEL_TERMS.account}します。`,
	accountDeleteNoAdultHint: `${CHILD_TERMS.honorific}のデータを残したい場合は、いったんこの画面を閉じて、メンバー管理から別の${PARENT_TERMS.honorific}を招待し、その方にオーナーを引き継いでから${CANCEL_TERMS.account}してください。`,
	// #4512: 退会フローの確認テキスト / ボタン / エラー (旧: settings/account/+page.svelte 直書き)。
	// 合言葉は入力欄・placeholder・判定の 3 箇所が同じ定数を見るようにする
	// (data グループの clearConfirmKeyword と同型)。
	// #4642 整合: 合言葉の値そのものは CANCEL_TERMS.confirmPhrase (atom) が SSOT。
	// ここで文字列リテラルを複製すると atom を変えても追従せず、確認語と判定がずれる
	// (DESIGN.md §6「terms.ts atom 値の文字列リテラル直書き複製」禁止)。
	accountDeleteConfirmKeyword: CANCEL_TERMS.confirmPhrase,
	accountDeleteConfirmFieldLabel: `確認のため「${CANCEL_TERMS.confirmPhrase}」と入力してください`,
	accountDeleteTransferPlaceholder: '移譲先を選択...',
	accountDeleteTransferSubmit: `移譲して${CANCEL_TERMS.account}`,
	accountDeleteFullSubmit: '全て削除する',
	accountDeleteSubmit: 'アカウントを削除する',
	accountDeleteProcessing: '処理中...',
	accountDeleteInfoFetchFailed: '情報取得に失敗しました',
	accountDeleteFailed: 'アカウント削除に失敗しました',
	// おやカギコード変更フォーム
	oyakagiChangeSubmitting: '変更中...',
	oyakagiAllFieldsRequired: 'すべてのフィールドを入力してください',

	// ログアウト
	logoutSectionTitle: 'ログアウト',
	logoutDesc:
		'このデバイスからがんばりクエストのアカウントからログアウトします。再度ログインするにはメールアドレスとパスワードが必要です。',
	logoutAction: 'アカウントからログアウト',

	// #2319 Phase Settings-Audit: hub page (6 グループへのナビ集約)
	hubTitle: '設定',
	hubDesc: '下のカードから設定したい項目を選んでください。',
	groupAccountTitle: 'アカウント',
	// #4661 / #4716: 「おやかぎコード」ひらがな直書きは同一画面のガイド表記 (おやカギコード) と
	// 揺れていたため atom 参照にする。3 つ目はカード内の見出し (accountDeleteSectionTitle)
	// と同じ「アカウント削除」に揃える (CANCEL_TERMS.account「退会」はサブスク文脈の語)。
	groupAccountDesc: `${OYAKAGI_TERMS.name}変更・ログアウト・アカウント削除`,
	groupActivitiesTitle: '活動・ポイント',
	groupActivitiesDesc: `ステータス減少・ポイント表示・既定の${CHILD_TERMS.honorific}・きょうだいチャレンジ`,
	groupNotificationsTitle: '通知',
	groupNotificationsDesc: 'リマインダー・ストリーク警告・サイレント時間帯',
	groupDataTitle: 'データ',
	groupDataDesc: `${BACKUP_TERMS.exportNoun}・クラウド共有・${BACKUP_TERMS.clearAll}`,
	groupSupportTitle: 'サポート・アプリ情報',
	groupSupportDesc: 'お問い合わせ・フィードバック・利用規約・バージョン',
	// #3954: /admin/settings/rules への導線。実装済み (#3339 ごほうび交換の承認要否) に
	// 保護者が到達できず「どこから変更できますか」と問い合わせが来たため hub にカードを追加する。
	groupRulesTitle: RULES_TERMS.settingsMenu,
	// #4666 F6: 一覧の実ボタン (有効化 / 無効化) と同じ語にする。
	groupRulesDesc: 'ごほうび交換の承認要否・ボーナスポイントの 有効化 / 無効化',
	groupPlanTitle: ADMIN_SCREENS.subscription.name,
	groupPlanDesc: 'プラン変更・請求履歴 (別ページ)',
	backToHub: '← 設定トップへ',

	// Danger Zone (#2319 子#2 / #4 GitHub パターン)
	dangerZoneTitle: '危険な操作',
	dangerZoneDesc: '以下の操作は元に戻せません。実行前に内容を必ず確認してください。',
	dangerStep1Label: '手順 1: 確認テキストを入力',
	dangerStep2Label: '手順 2: 同意チェック',
	// #4642: 確認語そのものは CANCEL_TERMS.confirmPhrase が atom (退会 / 引っ越し合流で共通)。
	// ここは atom を文に組み立てた compound (ADR-0045 §3.3)。
	dangerConfirmInputLabel: `確認のため「${CANCEL_TERMS.confirmPhrase}」と入力してください`,
	dangerStep3Label: '手順 3: 実行ボタン',
	clearDangerConsentLabel: `${BACKUP_TERMS.clearAll}することに同意します`,
	// #4716 item 15: 画面に直書きされていた顧客可視文言を SSOT へ移す
	// #4716 item 15: /admin/settings/account と /admin/settings/activities /
	//   /admin/settings/notifications に直書きされていた顧客可視文言を SSOT へ。
	//   確認語 / その入力ラベルは #4642 の CANCEL_TERMS.confirmPhrase / dangerConfirmInputLabel が
	//   SSOT (退会と引っ越し合流で共通)。ここで複製しない。
	accountInfoFetchError: '情報取得に失敗しました',
	accountDeleteError: 'アカウント削除に失敗しました',
	accountTransferSelectPlaceholder: '移譲先を選択...',
	accountProcessing: '処理中...',
	accountTransferAndLeave: '移譲して退会',
	accountDeleteAllButton: '全て削除する',
	accountDeleteButton: 'アカウントを削除する',
	decayNoneLabel: 'なし',
	decayNoneDesc: '減少しません（練習や導入期間向け）',
	decayGentleLabel: 'ゆるやか',
	decayGentleDesc: '通常の半分の速度で減少します',
	decayNormalLabel: 'ふつう',
	decayNormalDesc: '猶予2日後にゆるやかに減少します',
	decayStrictLabel: 'きびしめ',
	decayStrictDesc: '上級者向け。1.5倍の速度で減少します',
	currencyFieldLabel: '通貨',
	currencyRateFieldLabel: (symbol: string) => `レート（1P = ？${symbol}）`,
	currencyRateHint: '例: 1P = 1円なら「1」、1P = 0.01ドルなら「0.01」',
	// #4716 の「直書き文言を SSOT へ」は、#4664 F8 が同じ 3 語を
	// notificationReminderTimeLabel / notificationQuietLabel / notificationQuietHint として
	// 先に置いており (ページガイドと共有)、そちらを画面が参照する。同義キーを 2 組持つと
	// 片方だけ直して割れるので重複を置かない。
	// #4512: データクリアの確認テキスト / 実行ボタン。旧実装は画面 (+page.svelte) と
	// 検証 (+page.server.ts) が '削除' を別々に直書きしており、合言葉を変えると
	// 「入力しても通らない」状態になり得た。両者が同じ定数を見るようにする。
	// #4716: 文言側は BACKUP_TERMS に寄せる (「データクリア」は内部語)。
	clearConfirmKeyword: '削除',
	clearConfirmFieldLabel: '確認のため「削除」と入力してください',
	clearConfirmRequired: '確認テキスト「削除」を入力してください',
	clearAgreeRequired: '同意チェックを入れてください',
	clearSubmitting: `${BACKUP_TERMS.clearAll}しています…`,
	clearSubmitButton: BACKUP_TERMS.clearAll,
	clearFailed: `${BACKUP_TERMS.clearAll}に失敗しました`,
	// #4524: 同意チェックの文言は猶予 notice (accountDeleteGraceNotice) と **同じ事実**を述べる。
	//   旧実装はプランに依らない固定文で「元に戻せません」と断定しており、猶予のある有料プラン
	//   では直上の notice (「N 日間は復元で取り消せます」) と正面から矛盾していた。最も不可逆性の
	//   高い操作の直前で 2 文が食い違うと、警告全体が信用されなくなる。
	//
	//   graceDays が null (プラン未解決) のときに `?? 'free'` 相当へ倒さない: 猶予のある親に
	//   「元に戻せません」を見せるのは事実と異なる誤誘導になるため、断定しない中立文にする
	//   (accountDeleteGraceNotice / deletionGraceDays の扱いと同じ、#4517)。
	accountDeleteDangerConsentLabel: (graceDays: number | null) =>
		graceDays === null
			? 'このアカウントを削除することに同意します'
			: graceDays === 0
				? 'このアカウントを削除することに同意します（元に戻せません）'
				: `このアカウントを削除することに同意します（${graceDays} 日以内なら「復元」ボタンで取り消せます）`,
	// 削除前のデータ持ち出し (#740 API / #4472 導線)。プランに関係なく提供する
	accountDeleteExportTitle: `${CANCEL_TERMS.account}する前にデータを持ち出す`,
	accountDeleteExportAction: 'データをダウンロード',
	accountDeleteExportSubmitting: '準備しています…',
	accountDeleteExportScopeMinimal:
		'お子さまの名前と、記録した件数・期間のまとめを JSON ファイルで保存します。',
	accountDeleteExportScopeFull:
		'活動記録・スタンプ・ごほうびを含む全データを JSON ファイルで保存します。',
	accountDeleteExportScopeFamily: '全データときょうだいの比較データを JSON ファイルで保存します。',
	accountDeleteExportSuccess: (filename: string) => `${filename} を保存しました。`,
} as const;

/**
 * #2319 settings サブナビ用ラベル (AdminLayout 統合不要、settings 専用 +layout.svelte で参照)
 */
export const SETTINGS_NAV_LABELS = {
	ariaLabel: '設定サブナビゲーション',
	hub: '設定トップ',
	account: 'アカウント',
	activities: '活動・ポイント',
	notifications: '通知',
	data: 'データ',
	// #3954: hub カードと同じ経路をサブナビにも出す (どちらか片方だけだと、
	// hub 経由で来た人はサブナビのタブが 1 つも選択されていない状態になる)。
	// #4024: 当初は「サブナビは幅が限られる」として短縮形にしたが、**短縮しても 1280px で
	// サブナビは 2 行に折り返しており、短縮の目的を達成していなかった** (#3996 の SS が反証)。
	// 折り返しが避けられない以上、同じ画面に名前を 2 つ持つ対価に見合わないため長い名前に統一する。
	rules: RULES_TERMS.settingsMenu,
	support: 'サポート',
	plan: ADMIN_SCREENS.subscription.name,
	externalIndicator: '別ページ',
	externalIndicatorHub: '別ページへ',
} as const;

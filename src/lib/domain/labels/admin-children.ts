// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/children。置き場所の規則は docs/DESIGN.md §6
import { adminScreenHeading } from '../admin-screens';
import { CHILD_ADMIN_TERMS, CHILD_TERMS } from '../terms';

export const ADMIN_CHILDREN_LABELS = {
	addButton: `+ ${CHILD_TERMS.honorific}を追加`,
	backToList: '← 一覧に戻る',
	statAgeLabel: '年齢',
	statAgeTierLabel: '年齢区分',
	statBalanceSuffix: '残高',
	statLevelLabel: 'レベル',
	statusTabEmpty: 'ステータス詳細は登録後にご覧いただけます',
	logsTabEmpty: '活動ログは登録後にご覧いただけます',
	achievementsTabEmpty: '実績一覧は登録後にご覧いただけます',
	voiceTabEmpty: 'おうえんボイスは登録後にご利用いただけます',
} as const;

/**
 * ChildProfileCard / ChildProfileCard 編集モード用ラベル (#1465 Phase D)
 */
export const CHILD_PROFILE_CARD_LABELS = {
	// Edit mode
	editingBadge: '編集中',
	avatarSectionTitle: 'プロフィール写真',
	avatarUploadButton: '📷 写真を変更',
	avatarNetworkError: 'ネットワークエラーが発生しました',
	avatarFileSizeError: (sizeMB: string) =>
		`ファイルサイズが大きすぎます（${sizeMB}MB）。5MB以下の画像を選択してください`,
	avatarServerError: 'サーバーエラーが発生しました。5MB以下のJPEG/PNG/WebPを選択してください',
	avatarUploadFailed: 'アップロードに失敗しました',
	avatarUploadSuccess: '写真をアップロードしました',
	basicInfoTitle: '基本情報',
	nicknameLabel: 'ニックネーム',
	ageLabel: '年齢',
	ageAutoCalcSuffix: '（自動計算）',
	themeColorLabel: 'テーマカラー',
	birthdayBonusTitle: '🎂 おたんじょうびボーナス',
	birthdayBonusNote: '※ ボーナス倍率の変更は別途保存されます',
	// #4729 PO 決定 (2026-09-04): 誕生日は任意入力なので消せる。ただし誤って消すと
	// 誕生日ボーナスを失うため、**保存前に**確認を挟む (事後の Alert は
	// ADMIN_CHILDREN_PAGE_LABELS.birthdayClearedNotice)。
	// 「何が起きるか」「何が残るか」「何が失われるか」「どうすれば再開できるか」を 1 文ずつで書く。
	//
	// **失われるものを名指しする**: 保存すると入力された誕生日は破棄され、その年齢の推定誕生日 (1/1)
	// に置き換わる (`resolveBirthDateForUpdate`)。取り消し操作は無く、export / バックアップにも
	// 残らない (公開値は null)。ただし**日付を覚えていれば入れ直せる**ので、「元に戻せません」と
	// だけ書くと保護者には誇張に読める (実際に失われるのは「アプリが覚えていた日付」)。
	// 事後の Alert (birthdayClearedNotice) と**同じ 2 点** — 日付は消える / 入れ直せば再開する —
	// を述べ、保存前と保存後で言うことが食い違わないようにする。
	birthdayClearConfirmTitle: '誕生日を消しますか？',
	birthdayClearConfirmBody:
		'誕生日を消すと、誕生日のお祝いが行われなくなります。年齢はそのまま残ります。入力した誕生日はアプリから消え、取り消す操作はありません。お祝いを再開するには、もう一度誕生日を入れてください。',
	birthdayClearConfirmAccept: '消して保存する',
	// 誕生日を消したあとのカード表示。推定誕生日 (内部値) は出さず「未設定」と書く。
	headerBirthdayUnset: '誕生日: 未設定',
	saveButton: '💾 保存',
	cancelButton: 'キャンセル',
	multiplierLabel: '倍率',
	multiplierApplyButton: '適用',
	bonusFormulaPreview: (age: number, multiplier: number) =>
		`→ ${age}歳 × 100pt × ${multiplier}倍 = ${Math.round(age * 100 * multiplier)}pt`,
	deleteConfirmText: `この${CHILD_TERMS.honorific}を本当に削除しますか？`,
	deleteConfirmButton: '本当に削除',
	deleteCancelButton: 'やめる',
	// #4716 の呼称是正 (honorific) は CHILD_ADMIN_TERMS 側に入れてある。
	// ここで文字列を作り直すと #4660 のページガイドと実ボタン名が割れる。
	deleteOpenButton: CHILD_ADMIN_TERMS.deleteButton,
	editButton: CHILD_ADMIN_TERMS.editButton,
	// Tabs
	tabInfo: CHILD_ADMIN_TERMS.tabInfo,
	tabStatus: CHILD_ADMIN_TERMS.tabStatus,
	tabLogs: CHILD_ADMIN_TERMS.tabLogs,
	tabAchievements: CHILD_ADMIN_TERMS.tabAchievements,
	tabVoice: CHILD_ADMIN_TERMS.tabVoice,
	// Info tab
	infoAgeUnit: '歳',
	infoAgeLabel: '年齢',
	infoUiModeLabel: 'UIモード',
	infoBalanceSuffix: '残高',
	infoLogCountLabel: '累計記録数',
	// Status tab
	statusUpdateSuccess: 'ステータスを更新しました',
	statusEmpty: 'ステータスデータがありません',
	statusXpUnit: 'XP',
	statusLevelPrefix: '(Lv.',
	statusLevelSuffix: ')',
	statusSaveButton: '保存',
	// Logs tab
	logsEmpty: '活動記録がありません',
	// Achievements tab
	achievementsEmpty: '実績がありません',
	// Voice tab
	voiceHint: '録音または音声ファイルを登録すると、活動完了時にお子さんに再生されます。',
	voiceRecorderTitle: '🎤 録音する',
	voiceRecordingPrefix: '● 録音中 ',
	voiceRecordingSuffix: '秒 / 10秒',
	voiceStopButton: '■ 停止',
	voiceCancelRecording: '取消',
	voiceStartButton: '● 録音開始（最大10秒）',
	voiceUploadTitle: '📁 ファイルからアップロード',
	voiceLabelLabel: 'ラベル',
	voiceLabelPlaceholder: 'ラベル（例: お母さんの声）',
	voiceUploading: 'アップロード中...',
	voiceSaveButton: '💾 保存',
	voiceUseRecordingNote: '✅ 録音データを使用します',
	voiceListTitle: (count: number) => `登録済み（${count}件）`,
	voiceActiveIndicator: '●',
	voiceInactiveIndicator: '○',
	voiceActivateButton: '有効化',
	voiceDeleteButton: '削除',
	voiceEmpty: 'ボイスが登録されていません。録音またはファイルアップロードで追加できます。',
	voicePriorityNote: '※ 有効なボイスが設定されている場合、ショップの効果音よりも優先されます。',
	// Header
	headerAgeTierSeparator: '歳 / ',
	headerBirthdayPrefix: '🎂 ',
} as const;

export const ADMIN_CHILDREN_PAGE_LABELS = {
	pageTitle: adminScreenHeading('children'),
	// #4546 ③: 仮アバターの作り直しをレースで見送ったときの通知 (ADR-0062 §1「一時的・回復可能」= Toast)。
	// 「失敗」ではなく「写真を優先した」正常な結果なので、責めず・次にどうすればよいかまで書く。
	placeholderAvatarSkippedTitle: 'アバターはそのままです',
	placeholderAvatarSkippedDesc:
		'編集中に写真がアップロードされたため、写真をそのまま残しました。頭文字のアバターに戻すには、写真を削除してください。',
	// #4729 PO 決定 (2026-09-04): 保護者は誕生日を消せる (誕生日は任意入力であり、消せないほうが
	// 説明と矛盾する)。消すと誕生日ボーナス / 🎂 表示の対象から外れるため、**黙って消してはならない**
	// — 何が起きたかを保護者が画面で見られる文言 (Alert、自動消滅しない)。
	// 再入力でお祝いを再開できることも添え、誤操作の出口を残す。
	//
	// 消す操作は `ChildProfileCard` の確認ダイアログ (birthdayClearConfirm*) → 保存 → 本 Alert の
	// 3 点セット。**保存では実誕生日が破棄され、その年齢の推定誕生日 (1/1) に置き換わる**ので
	// 元の月日は戻せない (`resolveBirthDateForUpdate`)。だから「消える」ことを事前に確認する。
	// 消すのは保護者の明示操作だけ — import 復元は `import-service.ts` が
	// `birthDate: exportChild.birthDate ?? undefined` を渡すため今も null にならない (黙って消えない)。
	birthdayClearedNotice:
		'誕生日を消したため、誕生日のお祝いは行われません。入力した誕生日はアプリに残っていません。もう一度誕生日を入れると、お祝いを再開します。',
	limitBannerTitle: `${CHILD_TERMS.honorific}の登録上限に達しています`,
	limitBannerDesc: (current: number, max: number) => `現在 ${current}人 / 最大 ${max}人。`,
	limitUpgradeLink: '🚀 プランをアップグレードする →',
	cancelButton: 'キャンセル',
	limitReachedButton: CHILD_ADMIN_TERMS.limitReachedButton,
	// #4716: 保護者画面の呼称は honorific (旧「こどもを追加」)
	addFormTitle: `${CHILD_TERMS.honorific}を追加`,
	// #4716 item 15: 画面直書きだった placeholder を SSOT へ
	nicknamePlaceholder: '例: たろうくん',
	nicknameLabel: CHILD_ADMIN_TERMS.nickname,
	birthdayHint: '設定すると年齢が自動計算されます',
	// #4716: テーマカラーも atom 参照に (develop の #4718 が足した age 系 atom 参照と併存させる)
	themeColorLabel: CHILD_ADMIN_TERMS.themeColor,
	addButton: CHILD_ADMIN_TERMS.addButton,
	ageLabel: CHILD_ADMIN_TERMS.age,
	// #4718: 誕生日を入れると年齢は自動計算になるため、入力欄の label をそちらに差し替える。
	ageLabelAutoCalc: `${CHILD_ADMIN_TERMS.age}（誕生日から自動計算）`,
	agePlaceholder: '4',
	birthdayOrAgeRequired: '誕生日または年齢を入力してください',
	ageRange: '0〜18で入力してください',
	// #4512: +page.svelte / +page.server.ts に直書きされていた子供管理固有の文言。
	// リソース非依存のものは ADMIN_FORM_ERROR_LABELS を参照する。
	// (nicknamePlaceholder は #4716 item 15 が上で定義済のため重複を置かない)
	nicknameRequired: 'ニックネームを入力してください',
	birthdayFormatInvalid: '誕生日の形式が正しくありません（YYYY-MM-DD）',
	birthdayFutureNotAllowed: '未来の日付は設定できません',
	statusValueRange: '値は0〜100000の範囲で入力してください',
	birthdayMultiplierRange: '倍率は0.5〜3.0の範囲で設定してください',
	// おうえんボイス (uploadVoice action)
	voiceLabelRequired: 'ラベルを入力してください',
	voiceFileRequired: '音声ファイルを選択してください',
	voiceErrorInvalidFile: 'ファイルが不正です',
	voiceErrorFileTooLarge: '5MB以下にしてください',
	voiceErrorUnsupportedType: 'MP3/M4A/WAV/WebM/OGG形式のみ',
	voiceErrorTooMany: '10件まで登録可能です',
	// #4919: 追加成功時の 2 層 feedback (Toast + role="status" banner、admin/activities と同型)。
	// 一覧反映を待たず (`use:enhance` 成功直後) 表示するため、追加したニックネームを埋め込む。
	addedSuccess: (nickname: string) => `${nickname}を登録しました`,
} as const;

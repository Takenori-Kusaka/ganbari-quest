// labels 層 (ADR-0045 / #4965): 初期設定・オンボーディング (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
// 活動記録の失敗契約 (3 service の戻り型と共有)。文言の網羅を型で強制するために型だけを引く
import type { RecordActivityErrorCode, RecordActivityFailure } from '../activity-record-failure';
import {
	ADMIN_SCREEN_TERMS,
	ADMIN_VIEW_TERMS,
	CHILD_ADMIN_TERMS,
	CHILD_TERMS,
	PLAN_FULL_TERMS,
	TEMPLATE_TERMS,
} from '../terms';
import { SETTINGS_NAV_LABELS } from './admin-settings';
import { formatDateRange } from './format';

/**
 * setup wizard の一括取込ステップ（活動パック → rewards / ごほうびセット → rules /
 * ルール → activities-defaults）が次画面へ引き継ぐ「N 件追加（M 件は登録済みのため
 * スキップ）」の共通文言 (#4912)。3 画面が同じ形の notice を出すため、個別 namespace に
 * 複製せずここに一元化する。0 件 (= スキップ操作 / 何も取込まれなかった) のときは
 * 呼び出し側で表示自体を抑制する (本関数は呼ばない)。
 */
export function formatSetupImportNotice(imported: number, skipped: number): string {
	if (skipped > 0) {
		return `${imported}件追加しました（${skipped}件は登録済みのためスキップしました）。`;
	}
	return `${imported}件追加しました。`;
}

// ============================================================
// セットアップフロー (#1452 Phase B)
// ============================================================

export const SETUP_LABELS = {
	layoutTitle: '初期セットアップ',
	// #4512: setup wizard の step 名。旧実装は setup/+layout.svelte に直書きだった。
	stepChildren: '子供登録',
	stepQuestionnaire: 'かんたん質問',
	stepPacks: '活動',
	stepRewards: 'ごほうび',
	stepRules: 'ルール',
	stepActivitiesDefaults: '活動初期設定',
	stepChallenges: '家族チャレンジ',
	stepFirstAdventure: 'はじめての冒険',
	stepComplete: '冒険の始まり',
	// #4512: プレビュー開閉トグル。packs / rewards / rules / challenges の 4 step で同一文言のため
	//   step 個別 namespace ではなく setup 共通に置く (SETUP_CHALLENGES_LABELS からも参照する)。
	previewToggleOpen: '▼ なかみ',
	previewToggleClose: '▲ とじる',
	// #4863 (PO 決裁 2026-09-09): 全 step 共通の「戻る」文言。step 個別 namespace に散らすと
	//   step を足したときに片方だけ増えるので、**共通に 1 つだけ**置く。
	backButton: 'もどる',
	// #4863: 全 step 共通の出口。ウィザードを最後まで歩かずに降りたい人が、7 回スキップを
	//   押さずに済むようにする。中断した印は立ったままなので「続きをする」で戻ってこられる。
	leaveWizard: 'あとでやる',
} as const;

// ============================================================
// はじめてのぼうけんページ (#1452 Phase B)
// ============================================================

/** 「あとでやる」ボタンの文言。失敗時の次アクション案内から同じ語で参照する。 */
const SETUP_FIRST_ADVENTURE_SKIP_BUTTON = 'あとでやる（スキップ）';

/**
 * セットアップの選択画面 (パック / ごほうび / ルール) を JavaScript 無しで開いたときの案内
 * (PO 決裁 2026-09-10 決定 7)。
 *
 * これらの画面は取り込む対象を **`<button type="button">` + client state** で選ばせるため、
 * JavaScript が無効だと選択そのものが成立しない。**no-JS での前進は支えないと決めた**ので、
 * 「動かない画面を黙って見せる」のをやめ、何が必要かと次の一手だけを伝える。
 */
export const SETUP_NOSCRIPT_LABELS = {
	title: 'この画面には JavaScript が必要です',
	body: 'このページは、取り込む内容を選ぶために JavaScript を使います。ブラウザの設定で JavaScript を有効にしてから、このページを開き直してください。',
	// 有効化できない事情がある人を行き止まりにしない。設定は後から管理画面でも変えられる。
	fallback: `JavaScript を有効にできない場合は、この手順を飛ばして先に進んでいただいても、あとから${ADMIN_VIEW_TERMS.canonical}で同じ内容を追加できます。`,
} as const;

export const SETUP_FIRST_ADVENTURE_LABELS = {
	successTitle: (nicknameVocative: string) => `${nicknameVocative}すごい！`,
	recordedDesc: (activityName: string) => `「${activityName}」をきろくしたよ！`,
	pointsGetLabel: 'ポイントゲット！',
	levelUpLabel: 'レベルアップ！',
	startAdventureButton: 'ぼうけんをはじめる！',
	selectActivityTitle: 'はじめてのぼうけん！',
	selectActivityDescPart1: 'さいしょのがんばりを',
	selectActivityDescPart2: 'いっしょにきろくしよう！',
	noActivitiesMsg: `まだ活動が登録されていません。あとから${ADMIN_VIEW_TERMS.canonical}で追加できます。`,
	nextButton: '次へすすむ',
	recordingLabel: 'きろくちゅう...',
	recordButton: 'タップしてきろく！',
	selectActivityHint: 'がんばりをえらんでね！',
	// PO 決裁 2026-09-10 決定 8: きょうだいが複数いる家庭で、最初の 1 件を
	// **だれと一緒にやるか選ばせる**。旧実装は先頭の子で固定していたため、
	// 2 人目以降の保護者は「この子は無視されるのか」と受け取れた。
	childPickerLabel: 'だれといっしょにやる？',
	// 選ばせると今度は「1 人しか選べないのか」が不安になるので、必ず添える。
	childPickerReassurance: 'まずは 1 人と一緒に。ほかのお子さまはあとからでも大丈夫です',
	skipButton: SETUP_FIRST_ADVENTURE_SKIP_BUTTON,
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorActivityRequired: '活動を選択してください',
	errorRecordFailed: '記録に失敗しました。もう一度お試しください。',
	/** 同じ活動を同じ日にもう一度記録しようとした (recordActivity の ALREADY_RECORDED)。 */
	errorAlreadyRecorded: `この活動は今日すでに記録ずみです。ほかの活動を選ぶか、下の「${SETUP_FIRST_ADVENTURE_SKIP_BUTTON}」で次に進めます。`,
	/** その活動の 1 日の記録上限に達した (DAILY_LIMIT_REACHED)。 */
	errorDailyLimitReached: `この活動は今日の記録上限に達しました。ほかの活動を選ぶか、下の「${SETUP_FIRST_ADVENTURE_SKIP_BUTTON}」で次に進めます。`,
	/** 選んだ活動が見つからない (NOT_FOUND target='activity' — 別タブで削除された等)。 */
	errorActivityNotFound:
		'選んだ活動が見つかりませんでした。画面を読み込み直してから、もう一度お試しください。',
	/**
	 * 記録先の子供が見つからない (NOT_FOUND target='child')。越境 childId の
	 * cross-child guard (CWE-598 / ADR-0055 §3.1) もここに落ちる。活動の話にすり替えると
	 * 「活動を選び直す」という誤った次アクションを案内してしまうため、別文言にする。
	 */
	errorChildNotFound:
		'記録するお子さまを特定できませんでした。お子さまの登録をやり直すか、画面を読み込み直してください。',
	// #4868 adversarial: 直前の step (チャレンジ) の結果を**誰も読んでいなかった**。
	//   `?challengesAdded=N` は書き手 4 箇所 / 読み手 0 件で、親は「追加する」を押しても
	//   追加された / すでにある のどちらの feedback も受け取らなかった (ADR-0062 §1 の
	//   「状態起因 = banner + 次アクション」未達)。2 周目は必ず 0 件になるので、
	//   歩き直した親には**押しても何も起きない画面**に見えていた。
	challengesAddedNotice: (count: number) => `チャレンジを ${count} 件追加しました。`,
	challengesAlreadyNotice: 'チャレンジはすでに追加ずみでした。',
	// #4868 adversarial round 4: `added=0` の意味は「すでにある」だけでなく
	//   「作れなかった」もある。`errors` は書き手 3 / 読み手 0 で、失敗が親に一度も
	//   届いていなかった。全部失敗したときに「すでに追加ずみ」と言うと嘘になる。
	challengesFailedNotice: 'チャレンジを追加できませんでした。あとから設定できます。',
	// #4868 adversarial round 5: **部分失敗**。成功件数だけ出すと、入らなかった分が
	//   親に一度も届かない (`challengesFailed` を URL に載せながら画面は成功文言だけだった)。
	challengesPartialNotice: (added: number, failed: number) =>
		`チャレンジを ${added} 件追加しました。${failed} 件は追加できませんでした（あとから設定できます）。`,
	// #4908: 選んだカードの基礎ポイント (例: +10pt) と演出の合計ポイント (例: +20pt) が
	//   ストリーク / 習熟 / メインクエスト倍率等のボーナスで食い違うことがある。内訳を出さないと
	//   「10 と言ったのに 20」に見える。基礎と合計が一致するときはこの文言を出さない。
	pointsBreakdown: (base: number, total: number) =>
		`（きほん +${base}pt ＋ ボーナス +${total - base}pt）`,
} as const;

/**
 * `recordActivity` の失敗理由 → 初回記録画面 (`/setup/first-adventure`) に出す文言。
 *
 * `satisfies Record<RecordActivityErrorCode, string>` が網羅性を担保する。**service が
 * 失敗コードを増やすと、ここに文言を足すまでビルドが通らない** (domain SSOT
 * `$lib/domain/activity-record-failure` 経由で 3 service の戻り型と結ばれている)。
 */
const SETUP_FIRST_ADVENTURE_RECORD_ERRORS = {
	ALREADY_RECORDED: SETUP_FIRST_ADVENTURE_LABELS.errorAlreadyRecorded,
	DAILY_LIMIT_REACHED: SETUP_FIRST_ADVENTURE_LABELS.errorDailyLimitReached,
	NOT_FOUND: SETUP_FIRST_ADVENTURE_LABELS.errorActivityNotFound,
} as const satisfies Record<RecordActivityErrorCode, string>;

/**
 * `recordActivity` の失敗値を、初回記録画面に出す文言へ写す。
 *
 * #4512 時点では理由に関係なく `errorRecordFailed` を返していたうえ、画面側が `form.error` を
 * 一度も描画していなかったため「押しても何も起きない」= 無音の失敗になっていた (ADR-0062:
 * WCAG 3.3.1 / 4.1.3 の二重違反)。内部コード (`ALREADY_RECORDED` 等) はそのまま出さず
 * (docs/DESIGN.md §6 内部コード露出禁止 / ADR-0062 §2)、次アクションを必ず添える。
 *
 * 引数は**コード文字列ではなく失敗値そのもの**。`string` で受けていたときは service が
 * コードを増減・改名しても TypeScript が無警告で、顧客は黙って汎用文言に戻っていた。
 */
export function getSetupFirstAdventureRecordError(failure: RecordActivityFailure): string {
	// NOT_FOUND だけは target で意味が割れる (越境 childId か、消えた活動か)。
	if (failure.error === 'NOT_FOUND' && failure.target === 'child') {
		return SETUP_FIRST_ADVENTURE_LABELS.errorChildNotFound;
	}
	return (
		SETUP_FIRST_ADVENTURE_RECORD_ERRORS[failure.error] ??
		SETUP_FIRST_ADVENTURE_LABELS.errorRecordFailed
	);
}

// ============================================================
// デモごほうびページ (#1452 Phase B)
// ============================================================

// ============================================================
// セットアップ完了ページ (#1452 Phase B)
// ============================================================

export const SETUP_COMPLETE_LABELS = {
	title: 'ぼうけんのはじまり！',
	descPart1: 'ぼうけんじゅんびが',
	descPart2: 'かんりょうしたよ！',
	childCountUnit: '人',
	childCountLabel: `${CHILD_TERMS.honorific}`,
	activityCountUnit: 'こ',
	activityCountLabel: 'かつどう',
	nextMissionLabel: 'つぎのミッション',
	nextMissionText: '「きょうの がんばりを 3つ きろくしよう！」',
	ctaPrimary: `${CHILD_TERMS.honorific}がめんをひらく`,
	ctaSecondary: 'おやのせっていをみる',
	pinHintPrefix: `💡 ${ADMIN_VIEW_TERMS.canonical}の「せってい」から`,
	pinHintMiddle: 'を変更すると、おやの画面を守れるよ。',
	// #2992: 初回は既定 PIN 入力でなく新規作成フローのため、旧 5086 注記 (defaultValueHint) を置換
	pinHintSuffix: '初めて入るときに作成します。',
} as const;

export const SETUP_CHILDREN_LABELS = {
	pageTitle: `${CHILD_TERMS.honorific}を登録しよう`,
	pageDesc: `がんばりクエストを使う${CHILD_TERMS.honorific}を登録してください（1人以上）。`,
	registeredTitle: (count: number) => `登録済み（${count}人）`,
	ageModeSuffix: 'モード',
	// #4716: 親画面の子供呼称は honorific に統一
	addFormTitle: `${CHILD_TERMS.honorific}を追加`,
	// #4512: 追加フォームの入力ラベル / hint (旧: +page.svelte 直書き)
	nicknameLabel: CHILD_ADMIN_TERMS.nickname,
	nicknamePlaceholder: 'たろうくん',
	ageLabel: CHILD_ADMIN_TERMS.age,
	// #4718: 誕生日を入れると年齢は自動計算になるため、入力欄の label をそちらに差し替える。
	// 呼び出し側は src/routes/(parent)/admin/children/+page.svelte と setup/children/+page.svelte。
	ageLabelAutoCalc: `${CHILD_ADMIN_TERMS.age}（誕生日から自動計算）`,
	autoUiModeHint: (uiModeLabel: string) => `${uiModeLabel}モードが自動で設定されます`,
	// #4718: 誕生日は任意。入れた子だけ誕生日ボーナス (🎂) の対象になる。
	birthdayLabel: '誕生日（任意）',
	birthdayHint: '誕生日を入れると誕生日ボーナスが使えます。年齢だけでも登録できます。',
	birthdayInvalidFormat: '誕生日の形式が正しくありません（YYYY-MM-DD）',
	birthdayInFuture: '未来の日付は設定できません',
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorNicknameRequired: 'ニックネームを入力してください',
	errorAgeRange: '年齢は0〜18で入力してください',
	// #4716: 親画面の呼称は honorific
	errorNoChildren: `1人以上の${CHILD_TERMS.honorific}を登録してください`,
	themeColorLabel: CHILD_ADMIN_TERMS.themeColor,
	themePink: 'ピンク',
	themeBlue: 'ブルー',
	submittingLabel: '登録中...',
	addButton: CHILD_ADMIN_TERMS.addButton,
	nextButton: '次へ',
	backToHome: 'ホームに戻る',
	// #4696: 全削除後もこの画面に来るため、バックアップからの復元導線を出す
	restoreFromBackup: 'バックアップから復元する',
	addSuccessMessage: `${CHILD_TERMS.honorific}を登録しました！`,
	// #4716 item 15: setup 画面に直書きされていた顧客可視文言を SSOT へ
	nicknameFieldLabel: 'ニックネーム',
	ageFieldLabel: '年齢',
	expandCollapse: '▲ とじる',
	expandOpen: '▼ なかみ',
} as const;

export const SETUP_QUESTIONNAIRE_LABELS = {
	pageTitle: '📋 かんたんアンケート',
	pageDesc: 'お子さまに合った設定を自動でご用意します',
	// #1592 (ADR-0023 I4): 6→3 簡素化 — 親が「使い始めたいけど何ができるかわからない」を解消
	q1Legend: 'Q1. お子さまの課題は？（いくつでも）',
	// 新 3 軸の選択肢ラベル
	challengeHomeworkDaily: '毎日宿題をやらせたい',
	challengeChores: '家事をやらせたい',
	challengeBeyondGames: 'ゲーム以外のことに興味を惹かせたい',
	// #4912: この画面は保護者が操作する（#4802「保護者画面の呼称・見出しを 1 つに揃える」の対象漏れ）。
	// Q1 は漢字表記なのに Q2/Q3 だけ子供向けひらがな表記になっていたため、Q1 と同じ調子に揃える。
	q2Legend: 'Q2. 1日にどれくらい記録する？',
	activityLevelFewLabel: '少しずつ（3〜5個）',
	activityLevelFewDesc: 'はじめてでも無理なく',
	activityLevelNormalLabel: 'ふつう（5〜10個）',
	activityLevelNormalDesc: 'おすすめ',
	activityLevelManyLabel: 'たくさん（10個以上）',
	activityLevelManyDesc: 'いろいろ記録したい',
	recommendedBadge: 'おすすめ',
	q3Legend: 'Q3. チェックリストを自動作成する？',
	q3Hint: '選んだリストが自動で作成されます（あとから変更できます）',
	// プリセットラベル（チェックリスト一覧用）
	presetMorningRoutine: '朝の支度',
	presetEveningRoutine: '夜の準備',
	presetAfterSchool: '学校から帰ったら',
	presetWeekendChores: '週末のお手伝い',
	presetBeyondGames: 'ゲーム以外のチャレンジ',
	submittingLabel: '設定中...',
	startButton: 'この設定ではじめる！',
	skipButton: 'あとで設定する（スキップ）',
} as const;

// DEMO_ACHIEVEMENTS_LABELS: 実績機能廃止 (#1782 / #1816) で参照ゼロのため namespace 削除 (#1833)

export const SETUP_PACKS_LABELS = {
	// Round 18 Cluster A (ADR-0045): かつどうパック → TEMPLATE_TERMS atom 経由
	pageTitle: `${TEMPLATE_TERMS.userFacing}をえらぼう`,
	pageDesc: 'お子さまの年齢にあわせた活動セットを選んでください。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: `おすすめ${TEMPLATE_TERMS.short}を自動で追加してすすむ`,
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addPacksButton: (count: number) => `${count}件のパックを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'おすすめで次へ',
	// #1758 (#1709-D): must 推奨採用チェックボックス（setup フロー版）
	mustDefaultCheckboxLabel: '「今日のおやくそく」推奨を採用する',
	mustDefaultCheckboxHint:
		'歯みがき・お片付け・宿題などのおやくそく候補が、優先度「今日のおやくそく」として登録されます。',
	mustDefaultBadge: 'おやくそく推奨',
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorPackLoadFailed: (packId: string) => `パック「${packId}」の読み込みに失敗しました`,
} as const;

// #2140 MP-5: setup wizard β step 2「ごほうび一括追加」labels
export const SETUP_REWARDS_LABELS = {
	pageTitle: 'ごほうびセットをえらぼう',
	pageDesc:
		'お子さまのモチベーションになるごほうびを一括で追加できます。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめセットを自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addRewardsButton: (count: number) => `${count}件のセットを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'スキップして次へ',
	childPickerLabel: 'どのお子さまに追加しますか？',
	rewardsCountSuffix: '件のごほうび',
	emptyChildrenNotice: 'お子さまが登録されていないため、このステップはスキップされます。',
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorSetNotFound: (itemId: string) => `セット「${itemId}」が見つかりません`,
	errorSetLoadFailed: (itemId: string) => `セット「${itemId}」の読み込みに失敗しました`,
} as const;

// #2140 MP-5: setup wizard β step 3「ルール一括追加」labels
export const SETUP_RULES_LABELS = {
	pageTitle: 'おうちのルールをえらぼう',
	pageDesc:
		'家族のがんばりを応援するボーナスルールや交換ルールを一括で追加できます。あとから追加・変更できます。',
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめルールを自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: 'インポート中...',
	addRulesButton: (count: number) => `${count}件のルールを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'スキップして次へ',
	childPickerLabel: '交換ルールを追加するお子さま（任意）',
	childPickerNone: '選択しない（ボーナスルールのみ追加）',
	rulesCountSuffix: '件のルール',
	ruleTypeBonus: 'ボーナス',
	ruleTypeExchange: '交換',
	ruleTypePenalty: 'ペナルティ（取込未対応）',
	ruleTypeSpecial: 'スペシャル（取込未対応）',
	bonusOnlyNotice:
		'ボーナスルールは家族全体に適用されます。交換ルールはお子さまごとのごほうびとして登録されます。',
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorRuleNotFound: (itemId: string) => `ルール「${itemId}」が見つかりません`,
	errorRuleLoadFailed: (itemId: string) => `ルール「${itemId}」の読み込みに失敗しました`,
} as const;

// #2298 (EPIC #2294 ④): setup wizard β step 4「家族チャレンジ一括追加」labels
// 任意 step、auto-add 3 件 + 残 4 件は手動 import 動線。Research §5.1 onboarding 整合
/**
 * #2322 (EPIC #2319 ③): setup 任意 step「活動・ポイントの初期設定」用ラベル。
 * マーケプレ rule-preset 集約 (PO 提案) の Research 否定の代替案 A — sensible defaults を hard-code。
 */
export const SETUP_ACTIVITIES_DEFAULTS_LABELS = {
	pageTitle: '活動・ポイント設定の初期値',
	// #4909: 内部パス /admin/settings/activities の直書きを禁止（DESIGN.md §6「内部コード露出禁止」）。
	// 画面名は ADMIN_SCREEN_TERMS.settings (設定) + SETTINGS_NAV_LABELS.activities (活動・ポイント) で案内する。
	pageDesc: `おすすめの初期設定をワンタップで適用できます。あとから ${ADMIN_SCREEN_TERMS.settings} > ${SETTINGS_NAV_LABELS.activities} でいつでも変更できます。`,
	infoNotice:
		'これらの初期値はあくまでスタート地点です。家族の使い方に合わせて、あとから自由に変更できます。',
	defaultsSummaryTitle: '適用される初期設定',
	defaultDecayLabel: 'ステータス減少: ふつう（最初の2日は減少しません）',
	defaultPointModeLabel: 'ポイント表示: 「P」（あとで通貨換算も選べます）',
	defaultSiblingModeLabel: 'きょうだいチャレンジ: 協力（家族みんなで取り組みます）',
	// #4909: 撤去済み旧称「family」直書きを禁止（ADR-0045）。PLAN_FULL_TERMS.premium 経由にする。
	defaultSiblingRankingLabel: `きょうだいランキング: OFF（${PLAN_FULL_TERMS.premium}で ON 可能）`,
	applyButton: 'おすすめ初期値を適用してすすむ',
	applyingLabel: '適用中...',
	skipButton: 'スキップして次へ',
	backButton: 'もどる',
	applySuccessNotice: 'おすすめ初期値を適用しました',
} as const;

export const SETUP_CHALLENGES_LABELS = {
	pageTitle: '家族で挑戦するチャレンジを選ぼう',
	pageDesc: `家族みんなで取り組むチャレンジを一括で追加できます。スキップしても、あとから${ADMIN_VIEW_TERMS.canonical}で追加できます。`,
	recommendedBadge: 'おすすめ',
	autoAddOption: 'おすすめ 3 件を自動で追加してすすむ',
	backButton: 'もどる',
	importingLabel: '取込中...',
	addChallengesButton: (count: number) => `${count}件のチャレンジを追加`,
	processingLabel: '処理中...',
	skipNextButton: 'スキップして次へ',
	challengesNotice: '家族全員で協力するチャレンジです。クリアすると家族みんなに点数が配られます。',
	noticeNoChildren: 'お子さまが登録されていないため、このステップはスキップされます。',
	targetSuffix: '回',
	rewardSuffix: 'P',
	// #4911: 保護者向け日付書式 SSOT (formatDateRange) 経由に統一。旧実装は ISO 文字列
	// (`2027-03-01`) をそのまま出しており #4802 の日付書式統一から漏れていた。
	periodFormat: (start: string, end: string): string => `期間: ${formatDateRange(start, end)}`,
	// #4512: 同一文言が packs / rewards / rules にも直書きされていたため SETUP_LABELS に集約
	previewToggleOpen: SETUP_LABELS.previewToggleOpen,
	previewToggleClose: SETUP_LABELS.previewToggleClose,
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorNoChildren: `${CHILD_TERMS.honorific}が登録されていません`,
	errorPresetNotFound: (presetId: string) => `プリセット「${presetId}」が見つかりません`,
	errorAddFailed: (title: string, reason: string) => `「${title}」の追加に失敗: ${reason}`,
} as const;

// ============================================================
// オンボーディングチェックリスト (#1361)
// ============================================================

export const ONBOARDING_LABELS = {
	title: 'はじめてのセットアップ',
	optionalSectionLabel: 'さらに便利にする設定',
	optionalCountSuffix: (n: number) => `任意・${n} 項目`,
	optionalSectionHeader: (n: number) => `さらに便利にする設定（任意・${n} 項目）`,
	allRequiredCompleted: '✅ はじめてのセットアップ完了!',
	completedSuffix: '完了',
	nextRecLabel: '次のおすすめ:',
	dismissBtn: '非表示にする',
	// #4866 系 QM 監査 (onboarding) / PO 差し戻し 2026-09-09:
	// checklist の項目名 4 件が `onboarding-service.ts` に日本語直書きされていた
	// (他の 2 件は既に `PAGE_TITLES` / `OYAKAGI_LABELS` 経由で、**半分だけ SSOT を通っていた**)。
	// 呼称は #4716 の既決事項 (保護者画面は `CHILD_TERMS.honorific`) を適用する。
	itemChildren: `${CHILD_TERMS.honorific}を登録する`,
	itemRewards: 'ごほうびプリセットを選ぶ',
	itemChecklist: 'チェックリストを作る',
	itemChildScreen: `${CHILD_TERMS.honorific}の画面を確認する`,
	// #4866 系 QM 監査 (onboarding) / PO 差し戻し 2026-09-09:
	// この項目は `/switch` を開いただけでは完了しない (完了するのは子供を選んで
	// **子供画面に入った時点**)。リンクを踏んだ保護者には「押したのに終わらない」に見えるため、
	// 着地先で**あと 1 タップ要ること**を明示する。
	itemChildScreenHint: `${CHILD_TERMS.honorific}のカードを選ぶと、この手順が完了します`,
} as const;

// ============================================================
// #2821: セットアップ再開導線 (離脱後の再入口) — SetupResumeBanner
// 顧客レビュー (2026-06-03) で「こども追加後ホームに戻ると次 step が分からない /
// テンプレ追加で活動管理に着地して迷子」が指摘された。OnboardingChecklist は /admin に
// しか出ないため、親が実際に着地する /switch・子供ホーム、および setup 由来の admin 遷移に
// 再開導線を出す。NN/G #1 (visibility of system status) / Anti-engagement (ADR-0012: 完了後は消える)。
// ============================================================
export const SETUP_RESUME_LABELS = {
	// /switch・子供ホームに出す「続きをやる」バナー
	resumeTitle: 'セットアップの続き',
	progressText: (done: number, total: number) => `あと ${total - done} ステップで準備完了`,
	resumeCta: '続きをする',
	// setup 由来で admin に着地したときの文脈バナー (?from=setup)
	contextTitle: '初期セットアップの途中です',
	contextDesc: '追加できたら、続きのステップに戻れます',
	backToSetupCta: 'セットアップに戻る',
	// 「・次は『<step 名>』」の追記句 (区切り・鉤括弧を SSOT に集約、hardcoded JP 増加回避)。
	nextStepSuffix: (label: string) => `・次は「${label}」`,
	// #4863 (PO 決裁 2026-09-09): ウィザードを中断した人に出す説明。
	//   admin の checklist (6 項目) を母数にした「あと N ステップ」は、9 step の
	//   ウィザードへ戻す人には**無関係な数字**になる (step 7 まで歩いた人に「あと 2」と出る)。
	//   行き先が変わるなら本文も変える — CTA だけ差し替えると「次は『活動を追加する』」と
	//   読んでボタンを押した親がアンケート画面に着く。
	// 見出しが「セットアップの続き」/「初期セットアップの途中です」なので、本文で
	//   「初期設定の途中です」と繰り返さない (隣接 2 行で同じことを言い、しかも
	//   「セットアップ」と「初期設定」で用語が割れる — DESIGN.md §6)。
	//   本文の仕事は**行き先を予告すること**に絞る (頭から始まることを事前に伝える)。
	wizardResumeDesc: '最初の質問から順に確認できます',
} as const;

// labels 層 (ADR-0045 / #4965): 子供の活動記録 (記録・スタンプ・冒険開始・おうえん・記録エラー)。置き場所の規則は docs/DESIGN.md §6
import { ADVENTURE_TERMS, PARENT_TERMS } from '../terms';
import { normalizeUiMode } from '../validation/age-tier-types';

export const CHILD_ACTION_ERROR_LABELS = {
	/** 送信値が想定の形式でない (uuid 不正 / 欠落など)。原因は子供に説明できないので操作の再試行を促す。 */
	invalidInput: 'うまく おくれなかったよ。もういちど ためしてね',
	/** 数値入力が数値として読めない。 */
	pointsNotNumber: 'すうじで いれてね',
	/** 数値入力が受理範囲外。 */
	pointsOutOfRange: (min: number, max: number) => `${min}から${max}までの すうじで いれてね`,
	/** 予期しない失敗 (例外) の既定文言。内部例外メッセージは出さない (ADR-0062)。 */
	unexpected: 'うまく いかなかったよ。もういちど ためしてね',
	/** 活動のピン留め (おきにいり) 拒否理由。service 層の code に 1:1 で対応する。 */
	pinActivityNotFound: 'その かつどうが みつからなかったよ',
	pinLimitExceeded: (max: number) => `おきにいりは ${max}こまでだよ`,
	// #4716 (QM #4802): home の action が直書きしていた失敗文言。年齢帯 variant は KANJI 側と key を揃える
	alreadyRecordedToday: 'きょうはもうきろくしたよ！',
	dailyLimitReached: 'きょうはこれいじょうきろくできないよ',
	notFound: 'みつかりません',
	cancelWindowPassed: 'とりけしじかんがすぎたよ',
	bonusAlreadyClaimed: 'きょうのボーナスはもうもらったよ！',
	stampAlreadyToday: 'きょうはもうスタンプをおしたよ！',
	stampAlreadyPressed: 'きょうはもうおしたよ',
	cardFull: 'カードがいっぱいだよ',
	stampUnavailable: 'いまスタンプをおせません。あとでもういちどためしてね',
	stampFailed: 'スタンプをおせませんでした',
	alreadyRedeemed: 'もうこうかんしたよ',
	emptyCard: 'スタンプがないよ',
	redeemFailed: 'こうかんできませんでした',
	bonusAlreadyReceived: 'もうもらったよ',
	noBirthdayBonus: 'おたんじょうびボーナスはありません',
	bonusClaimFailed: 'ボーナスをもらえませんでした',
	// チャレンジのごほうび受け取り (claimChildChallengeReward の code に 1:1)
	challengeNotFound: 'その チャレンジが みつからなかったよ',
	challengeWrongChild: 'この チャレンジは きみの ものじゃないよ',
	challengeNotCompleted: 'まだ クリアしていないよ',
	challengeAlreadyClaimed: 'もう うけとったよ',
} as const;

/**
 * 中高生 (junior / senior) 向けの失敗文言 (#4716 QM)。
 *
 * docs/DESIGN.md §8 は preschool / elementary = ひらがな、junior / senior = 漢字と定めている。
 * `CHILD_ACTION_ERROR_LABELS` は 5 年齢モード共通のひらがなだったため、16〜18 歳にも
 * 「うまく おくれなかったよ」を返していた。**key と意味は同一**にして本文だけ差し替える。
 */
const CHILD_ACTION_ERROR_LABELS_KANJI = {
	invalidInput: '送信できませんでした。もう一度お試しください',
	pointsNotNumber: '数字で入力してください',
	pointsOutOfRange: (min: number, max: number) => `${min}から${max}までの数字で入力してください`,
	unexpected: 'うまくいきませんでした。もう一度お試しください',
	pinActivityNotFound: 'その活動が見つかりませんでした',
	pinLimitExceeded: (max: number) => `お気に入りは${max}個までです`,
	alreadyRecordedToday: '今日はもう記録しました',
	dailyLimitReached: '今日はこれ以上記録できません',
	notFound: '見つかりません',
	cancelWindowPassed: '取り消しできる時間を過ぎました',
	bonusAlreadyClaimed: '今日のボーナスは受け取り済みです',
	stampAlreadyToday: '今日はもうスタンプを押しました',
	stampAlreadyPressed: '今日はもう押しました',
	cardFull: 'カードがいっぱいです',
	stampUnavailable: 'いまスタンプを押せません。あとでもう一度お試しください',
	stampFailed: 'スタンプを押せませんでした',
	alreadyRedeemed: 'もう交換しました',
	emptyCard: 'スタンプがありません',
	redeemFailed: '交換できませんでした',
	bonusAlreadyReceived: '受け取り済みです',
	noBirthdayBonus: '誕生日ボーナスはありません',
	bonusClaimFailed: 'ボーナスを受け取れませんでした',
	challengeNotFound: 'そのチャレンジが見つかりませんでした',
	challengeWrongChild: 'このチャレンジはあなたのものではありません',
	challengeNotCompleted: 'まだクリアしていません',
	challengeAlreadyClaimed: 'すでに受け取り済みです',
} as const;

/**
 * 年齢モードに応じた子供向け失敗文言を返す (#4716 QM)。
 *
 * `uiMode` を渡せない経路 (年齢帯を持たない route) では既定のひらがなに落ちる。
 * `if (uiMode === 'junior')` を呼び出し側に散らさないため、分岐は本関数 1 箇所に閉じる
 * (src/routes/CLAUDE.md §年齢帯 variant の A1「散在する uiMode 分岐」を作らない)。
 */
export function getChildActionErrorLabels(
	uiMode?: string,
): typeof CHILD_ACTION_ERROR_LABELS | typeof CHILD_ACTION_ERROR_LABELS_KANJI {
	const mode = uiMode ? normalizeUiMode(uiMode) : 'preschool';
	return mode === 'junior' || mode === 'senior'
		? CHILD_ACTION_ERROR_LABELS_KANJI
		: CHILD_ACTION_ERROR_LABELS;
}

// ============================================================
// スタンプカード N レアリティ ポジティブメッセージ (#1536)
// StampPressOverlay で N レアリティのスタンプ取得時に表示
// ============================================================

export const STAMP_PRESS_N_MESSAGES = {
	/** 準備モード (0-2歳) — 親向け、ひらがな・シンプル */
	baby: ['きょうも えらいね！', 'がんばったね！', 'すてき！', 'いいね！', 'すごいよ！'],
	/** 幼児 (3-5歳) — ひらがなのみ、大きな称賛 */
	preschool: [
		'よくがんばったね！',
		'えらい！えらい！',
		'さすが！',
		'すごいぞ！',
		'がんばってるね！',
	],
	/** 小学生 (6-12歳) — 元気よく、達成感を強調 */
	elementary: [
		'よくがんばった！',
		'さすが！すごい！',
		'今日もステキ！',
		'がんばってるね！',
		'どんどん成長してる！',
	],
	/** 中学生 (13-15歳) — クールに、内発的動機寄り */
	junior: ['いい感じ！', '続けてるのすごい！', 'ナイス！', 'さすがだね！', 'コツコツ最強！'],
	/** 高校生 (16-18歳) — フラットに、自律・継続を称える */
	senior: ['Good job!', '継続は力なり！', 'ナイスキープ！', '着実に積み上げてる！', '自分を誇れ！'],
} as const;

// ============================================================
// UI コンポーネント ラベル (#1465 Phase B)
// src/lib/ui/components/ 配下のハードコード文字列を集約
// ============================================================

// ============================================================
// 応援メッセージ (ParentMessageOverlay) の文言 — 年齢帯 variant
// ============================================================
//
// 保護者からの応援メッセージ dialog も年齢帯を持たず、16-18 歳の画面に
// 「💌 おうえんメッセージ！」「パパ・ママからのメッセージだよ」「うれしい！」が出ていた。
// 同じ画面でログインボーナス側だけ漢字にすると 1 画面に 2 文体が混ざる (docs/DESIGN.md §6)
// ため、押印演出と同じ層で出し分ける。

/** 応援メッセージ dialog の文言 (ベース = ひらがな: baby / preschool / elementary)。 */
const CHILD_PARENT_MESSAGE_LABELS = {
	parentMessageTitle: '💌 おうえんメッセージ！',
	parentMessageFrom: 'パパ・ママからのメッセージだよ',
	parentMessageBody: (body: string) => `「${body}」`,
	parentMessageConfirmBtn: 'うれしい！',
	/** #4688 (F4): 応援メッセージに付いたボーナスポイント (親が付けた額をそのまま出す) */
	parentMessageBonusPoints: (points: number | string) => `+${points}pt もらったよ！`,
} as const;

/**
 * 応援メッセージ dialog の文言セット。値の型は `string` / 関数に広げてある
 * (リテラル型のままだと年齢帯変種が別の文字列を入れられない)。
 */
type ChildParentMessageLabels = {
	readonly [K in keyof typeof CHILD_PARENT_MESSAGE_LABELS]: (typeof CHILD_PARENT_MESSAGE_LABELS)[K] extends string
		? string
		: (typeof CHILD_PARENT_MESSAGE_LABELS)[K];
};

/** 13-18 歳 (junior / senior) の漢字変種。差分だけを持ち、ベースに spread で重ねる。 */
const CHILD_PARENT_MESSAGE_KANJI_OVERRIDES = {
	parentMessageTitle: '💌 応援メッセージ',
	parentMessageFrom: `${PARENT_TERMS.honorific}からのメッセージ`,
	parentMessageConfirmBtn: 'OK',
	parentMessageBonusPoints: (points: number | string) => `+${points}pt 受け取りました`,
} as const satisfies Partial<ChildParentMessageLabels>;

/** 応援メッセージ dialog の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildParentMessageLabels(uiMode: string): ChildParentMessageLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') {
		return CHILD_PARENT_MESSAGE_LABELS;
	}
	return { ...CHILD_PARENT_MESSAGE_LABELS, ...CHILD_PARENT_MESSAGE_KANJI_OVERRIDES };
}

// ============================================================
// ログインボーナス受取 UI (押印演出 / スタンプカード) の文言 — 年齢帯 variant
// ============================================================
//
// ログインの押印演出 (`StampPressOverlay`) とヘッダーのスタンプカード (`StampCard`) は
// 年齢帯を持たず、13-18 歳にも「3にちれんぞく！」「きょうはもうおしたよ！」「やったね！」と
// いう幼児文体が出ていた (docs/DESIGN.md §8)。ひらがなをベースに、junior / senior だけ差分を
// override で重ねる (`src/routes/CLAUDE.md` §年齢帯 variant)。

/**
 * ログインボーナス受取 UI の文言 (ベース = ひらがな: baby / preschool / elementary)。
 *
 * export しない — 画面側は必ず `getChildStampLabels(uiMode)` を通す (ベースを直接読むと
 * 年齢帯の出し分けを迂回できてしまう)。
 */
const CHILD_STAMP_LABELS = {
	// ---- StampCard ----
	stampCardTitle: 'スタンプカード',
	stampCardPeriod: (start: string, end: string) => `${start}〜${end}`,
	stampCardRedeemed: (points: number) => `✅ ${points}pt もらったよ！`,
	stampCardComplete: '🎊 コンプリート！',
	stampCardCompleteSub: '週明けにボーナスポイントがもらえるよ！',
	stampCardStampedToday: '✅ きょうはもうおしたよ！',
	stampCardRemaining: (remaining: number) => `✨ あと${remaining}回でコンプリート！`,

	// ---- StampPressOverlay ----
	stampPressWeekLabel: (count: number) => `今週 ${count}回目！`,
	stampPressStreakLabel: (days: number) => `${days}にちれんぞく！`,
	stampPressComplete: 'コンプリート！',
	stampPressCompleteSub: '週末にボーナスポイント！',
	stampPressRemaining: (remaining: number) => `あと${remaining}回でコンプリート！`,
	stampPressNextBtn: 'つぎへ',
	stampPressConfirmBtn: 'やったね！',
	stampPressWeeklyTitle: '先週のがんばり',
	stampPressWeeklyCount: (filled: number, total: number) => `${filled}/${total} おしたよ！`,
	stampPressWeeklyComplete: 'コンプリート！',
	stampPressWeeklyBonus: (bonus: number) => `コンプリートボーナス +${bonus}pt`,
	stampPressWeeklyMessage: '今週もがんばろう！',
	/** #4687 ②: 週 5 枠が埋まっている日のログイン (スタンプは押せない) */
	stampPressAlreadyComplete: '今週はコンプリート！',
	/** #4687 ③: おみくじログインボーナス (台帳に載る額をそのまま出す) */
	stampPressLoginBonus: (rank: string, points: number | string) =>
		`おみくじ ${rank}！ +${points}pt`,
	stampPressLoginBonusNoRank: (points: number | string) => `ログインボーナス +${points}pt`,
	/** #4687 ①: 複数週ぶんをまとめて交換したときの見出し */
	stampPressWeeklyTitleMulti: (weeks: number) => `${weeks}週ぶんのがんばり`,
	// #4913: 押印ぶん (instantPoints) が何に対する +Npt か分からず、おみくじぶんの +Npt と
	// 並ぶと「+5pt」が 2 回連続で読める状態になっていた。おみくじ側と同じく「何の pt か」を
	// 明示し、両方ある日は合計行を出す。
	stampPressInstantPointsLabel: (points: number | string) => `スタンプ +${points}pt`,
	stampPressTotalPointsLabel: (points: number | string) => `あわせて +${points}pt`,
} as const;

/**
 * ログインボーナス受取 UI の文言セット。値の型は `string` / 関数に広げてある
 * (リテラル型のままだと年齢帯変種が別の文字列を入れられない)。
 */
type ChildStampLabels = {
	readonly [K in keyof typeof CHILD_STAMP_LABELS]: (typeof CHILD_STAMP_LABELS)[K] extends string
		? string
		: (typeof CHILD_STAMP_LABELS)[K];
};

/** 13-18 歳 (junior / senior) の漢字変種。差分だけを持ち、ベースに spread で重ねる。 */
const CHILD_STAMP_KANJI_OVERRIDES = {
	stampCardRedeemed: (points: number) => `✅ ${points}pt 受け取り済み`,
	stampCardCompleteSub: '週明けにボーナスポイントを受け取れます',
	stampCardStampedToday: '✅ 今日は押印済み',
	stampPressStreakLabel: (days: number) => `${days}日連続！`,
	stampPressNextBtn: '次へ',
	stampPressConfirmBtn: 'OK',
	stampPressWeeklyCount: (filled: number, total: number) => `${filled}/${total} 達成`,
	stampPressTotalPointsLabel: (points: number | string) => `合計 +${points}pt`,
} as const satisfies Partial<ChildStampLabels>;

/** ログインボーナス受取 UI の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildStampLabels(uiMode: string): ChildStampLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') return CHILD_STAMP_LABELS;
	return { ...CHILD_STAMP_LABELS, ...CHILD_STAMP_KANJI_OVERRIDES };
}

// ============================================================
// 初回の子供画面 (冒険スタート演出 / 活動 0 件の空状態) — 年齢帯 variant
// ============================================================
//
// `AdventureStartOverlay` は初回訪問の子供に出る (`variants/index.ts` の
// `FULL_FEATURES.showAdventureStart` = elementary / junior / senior)。文言が年齢帯を
// 持たない平坦な定数だったため、16-18 歳が受け取る**最初の 1 画面**が
// 「やあ！ / きょうから いっしょに ぼうけんだよ！ / したのカードをタップしてみてね」と
// いう幼児文体になっていた (docs/DESIGN.md §8)。活動 0 件の空状態 (`ActivityEmptyState`)
// も同じ理由で平坦だった。
// ひらがなをベースに、junior / senior だけ差分を spread で重ねる
// (src/routes/CLAUDE.md §年齢帯 variant)。

const CHILD_ADVENTURE_START_LABELS = {
	adventureGreeting: (name: string) => `やあ！ ${name}！`,
	adventureBigText1: 'きょうから いっしょに',
	adventureBigText2: 'ぼうけんだよ！',
	adventureSubText1: 'いろんなことを がんばると',
	adventureSubText2: 'つよくなれるよ！',
	adventureCharacterAlt: 'ぼうけんキャラクター',
	adventureReadyText: '🌟 さあ、はじめよう！ 🌟',
	adventureReadySub: 'したのカードをタップしてみてね',
	/**
	 * 活動が 1 件も無いまま初回訪問したとき。overlay とカード一覧は独立に分岐するため、
	 * 「したのカードをタップしてみてね」と言いながら下にカードが無い状態が起きていた。
	 */
	adventureReadySubEmpty: 'かつどうが とどいたら はじめよう',
	adventureStartBtn: 'ぼうけんスタート！',
} as const;

/**
 * 冒険スタート演出の文言セット。値の型は `string` / 関数に広げてある
 * (リテラル型のままだと年齢帯変種が別の文字列を入れられない)。
 */
type ChildAdventureStartLabels = {
	readonly [K in keyof typeof CHILD_ADVENTURE_START_LABELS]: (typeof CHILD_ADVENTURE_START_LABELS)[K] extends string
		? string
		: (typeof CHILD_ADVENTURE_START_LABELS)[K];
};

/** 13-18 歳 (junior / senior) の漢字変種。差分だけを持ち、ベースに spread で重ねる。 */
const CHILD_ADVENTURE_START_KANJI_OVERRIDES = {
	adventureGreeting: (name: string) => `ようこそ、${name}！`,
	adventureBigText1: '今日からいっしょに',
	adventureBigText2: `${ADVENTURE_TERMS.canonical}を始めよう！`,
	adventureSubText1: 'いろいろなことに挑戦すると',
	adventureSubText2: '強くなれます',
	adventureCharacterAlt: `${ADVENTURE_TERMS.canonical}キャラクター`,
	adventureReadyText: '🌟 さあ、始めよう！ 🌟',
	adventureReadySub: '下のカードを選んで記録してみよう',
	adventureReadySubEmpty: '活動が届いたら始めよう',
	adventureStartBtn: `${ADVENTURE_TERMS.canonical}スタート！`,
} as const satisfies Partial<ChildAdventureStartLabels>;

/** 冒険スタート演出の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildAdventureStartLabels(uiMode: string): ChildAdventureStartLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') {
		return CHILD_ADVENTURE_START_LABELS;
	}
	return { ...CHILD_ADVENTURE_START_LABELS, ...CHILD_ADVENTURE_START_KANJI_OVERRIDES };
}

const CHILD_ACTIVITY_EMPTY_LABELS = {
	activityEmptyTitle: 'ぼうけんの じゅんびちゅう...',
	activityEmptyDesc: 'おうちの人が かつどうを よういしているよ！',
	activityEmptyWait: 'もうすこし まってね ⏳',
	activityEmptyCanDo: '── できること ──',
	activityEmptyStatusLink: (statusLabel: string) => `${statusLabel}をみる`,
} as const;

/**
 * 活動 0 件の空状態の文言セット。値の型は `string` / 関数に広げてある
 * (リテラル型のままだと年齢帯変種が別の文字列を入れられない)。
 */
type ChildActivityEmptyLabels = {
	readonly [K in keyof typeof CHILD_ACTIVITY_EMPTY_LABELS]: (typeof CHILD_ACTIVITY_EMPTY_LABELS)[K] extends string
		? string
		: (typeof CHILD_ACTIVITY_EMPTY_LABELS)[K];
};

/** 13-18 歳 (junior / senior) の漢字変種。差分だけを持ち、ベースに spread で重ねる。 */
const CHILD_ACTIVITY_EMPTY_KANJI_OVERRIDES = {
	activityEmptyTitle: `${ADVENTURE_TERMS.canonical}の準備中...`,
	activityEmptyDesc: `${PARENT_TERMS.honorific}が活動を用意しています`,
	activityEmptyWait: 'もう少し待ってね ⏳',
	// activityEmptyCanDo ('── できること ──') は年齢帯で変わらないので override に置かない。
	// 同値の override は「差分だけ」の原則から外れ、次に base を直した人が割る
	// (src/routes/CLAUDE.md §年齢帯 variant)。
	activityEmptyStatusLink: (statusLabel: string) => `${statusLabel}を見る`,
} as const satisfies Partial<ChildActivityEmptyLabels>;

/** 活動 0 件の空状態の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildActivityEmptyLabels(uiMode: string): ChildActivityEmptyLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') {
		return CHILD_ACTIVITY_EMPTY_LABELS;
	}
	return { ...CHILD_ACTIVITY_EMPTY_LABELS, ...CHILD_ACTIVITY_EMPTY_KANJI_OVERRIDES };
}

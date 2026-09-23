// labels 層 (ADR-0045 / #4965): 子供のホーム画面。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_VIEW_TERMS, PARENT_TERMS } from '../terms';
import { normalizeUiMode, type UiMode } from '../validation/age-tier-types';

/**
 * #4313: 年齢帯 UI が誕生日で切り替わったことを次回ログインで伝えるダイアログの文言。
 *
 * key は **切替後 (to)** の uiMode。文面は「成長した」枠組みで書き、機能が減ったと
 * 読ませない (Issue #4313 §感情演出 / ADR-0012 — 静かに 1 回だけ)。
 * 年齢別の語彙整合 (DESIGN.md §6): preschool はひらがなのみ、elementary は漢字最小限、
 * junior / senior は漢字を含む。
 *
 * `parentNote` / `settings*` は全モード共通で保護者宛て (敬体)。3 歳の baby → preschool は
 * 切替前の画面が親向け準備モード (ADR-0011) であり、読み手が保護者であるため、この
 * 保護者向け節が主たる説明になる。
 */
export const UI_MODE_CHANGE_LABELS = {
	dialogAriaLabel: '年齢区分の変更のお知らせ',
	emoji: '🎈',
	heading: {
		baby: 'がめんが かわったよ',
		preschool: 'おおきく なったね！',
		elementary: '大きくなったね！',
		junior: 'ひとつ大きくなりましたね',
		senior: 'ひとつ大きくなりましたね',
	} as Record<UiMode, string>,
	body: {
		baby: 'おたんじょうびが きたから、がめんが かわったよ。',
		preschool:
			'おたんじょうびが きたから、がめんが すこし かわったよ。ボタンや もじの おおきさが かわって いるよ。',
		elementary:
			'おたんじょう日がきたので、画面が小学生むけにかわりました。ボタンや文字の大きさがかわっています。',
		junior:
			'誕生日を迎えたので、画面が中学生向けに切り替わりました。ボタンや文字の大きさが変わっています。',
		senior:
			'誕生日を迎えたので、画面が高校生向けに切り替わりました。ボタンや文字の大きさが変わっています。',
	} as Record<UiMode, string>,
	closeLabel: {
		baby: 'わかった',
		preschool: 'わかった！',
		elementary: 'わかった！',
		junior: 'OK',
		senior: 'OK',
	} as Record<UiMode, string>,
	parentNote:
		'保護者の方へ: お子さまの年齢区分が変わったため、画面が自動で切り替わりました。生年月日の確認・修正はお子さま管理から行えます。',
	settingsLabel: 'お子さま管理をひらく',
} as const;

/**
 * #4261 ③: 月間の習慣化証明書で増えた残高の理由を、子に**次回起動で 1 回だけ**伝える文言。
 *
 * ADR-0012 との両立条件 (PO 決裁 2026-08-06) を文言側でも守る:
 * **煽らない / 次を促さない / 演出語を足さない。** 起きた事実だけを静かに置く。
 * baby は親向けの準備モードで子供向けホームを持たない (ADR-0011) ため対象外。
 */
export const HABIT_CERTIFICATE_NOTICE_LABELS: Record<
	Exclude<UiMode, 'baby'>,
	{ title: string; body: (amount: string) => string }
> = {
	preschool: {
		title: 'こんげつ よく つづいたね',
		body: (amount) => `${amount} を うけとったよ`,
	},
	elementary: {
		title: '今月は しゅうかんに できたね',
		body: (amount) => `つづけられたので ${amount} をうけとりました`,
	},
	junior: {
		title: '今月は習慣にできました',
		body: (amount) => `継続の記録として ${amount} を受け取りました`,
	},
	senior: {
		title: '今月は習慣にできました',
		body: (amount) => `継続の記録として ${amount} を受け取りました`,
	},
};

export const CHILD_HOME_LABELS = {
	// Baby mode: completed card aria-label
	completedAriaLabel: (name: string) => `${name}（きろくずみ）`,

	// Baby mode: inline form submit button states
	babyCardMainQuestBadge: '⚔️ 2ばい!',
	babyCardPendingText: 'まってね！',

	// Baby mode: aria-label for submit button
	babyCardRecordAriaLabel: (name: string) => `${name}をきろくする`,
	babyCardRecordMainQuestSuffix: '（メインクエスト×2）',
	babyCardRecordMissionSuffix: '（ミッション）',

	// Pin context menu
	pinActionUnpin: '📌 ピンどめをはずす',
	pinActionPin: '📌 ピンどめする',
	pinCloseButton: 'とじる',

	// Confirm dialog
	confirmTitle: (name: string) => `${name}を\nきろくする？`,
	confirmTitleBr: (name: string) => `${name}を`,
	confirmTitleBrLine2: 'きろくする？',
	confirmCancelButton: 'やめる',
	confirmSubmitLoading: 'まってね！',
	confirmSubmitButton: 'きろく！',

	// Record result overlay
	resultCancelledIcon: '↩️',
	resultCancelledTitle: 'とりけしました',
	resultCancelledClose: 'とじる',
	resultFirstRecord: '🌟 はじめての いっぽ！ 🌟',
	resultActivityRecorded: (name: string) => `${name}をきろくしたよ！`,
	resultStreakBonus: (days: number | string, bonus: number | string) =>
		`${days}にちれんぞく！ +${bonus}ボーナス`,
	resultMasteryBonus: (bonus: number | string, level: number | string) =>
		`📗 なれてきたボーナス +${bonus} (Lv.${level})`,
	resultMasteryLevelUp: (name: string, level: number | string) =>
		`🎖️ ${name}が Lv.${level} になった！`,
	resultComboCategoryCombo: (name: string, catName: string) => `${name}コンボ！（${catName}）`,
	/**
	 * #4686: コンボは tier 名を「状態」として出し、金額は今回の純増 (台帳増分) だけを出す。
	 * tier 満額を毎回出すと同日 2 回目以降に「ダイアログの合計 ≠ 残高の増分」になるため。
	 */
	resultComboCategoryState: (name: string, catName: string) =>
		`${name}コンボ たっせい中（${catName}）`,
	resultComboCrossState: (name: string) => `${name}！ たっせい中`,
	resultComboNewBonus: 'コンボボーナス',
	/** #4686: フォーカスモード おすすめ 3 件全完了ボーナス (台帳 type=focus_bonus) の結果ダイアログ表記 */
	resultFocusBonus: '🎯 きょうのクエスト コンプリート！',
	/**
	 * #4916: 結果ダイアログの内訳 (基本ポイント行)。主要数字 (grandTotal) と内訳の整合を
	 * 顧客が追えるように、基本ポイントも 1 行として明示する。
	 */
	resultBreakdownBase: (points: number | string) => `きほん +${points}P`,
	/** #4916: メインクエスト倍率タグ (base 行に併記)。 */
	resultBreakdownMainQuestTag: '⚔️ メインクエスト ×2',
	/** #4916: bonus-hook 由来の倍率タグ (weekend 2倍 等、preset の title を動的に差し込む)。 */
	resultBreakdownMultiplierTag: (title: string, multiplier: number | string) =>
		`${title} ×${multiplier}`,
	/** #4916: bonus-hook 由来の加点行 (はやおきボーナス等、preset の title を動的に差し込む)。 */
	resultBreakdownBonusHook: (title: string, points: number | string) => `${title} +${points}P`,
	resultXpLabel: 'けいけんち',
	/**
	 * #4509 ⑤: きょうだいの名前が引けなかったときの汎用語。
	 * 内部 ID (`#<childId>`) を子供の画面に出さないためのフォールバック (DESIGN.md §6)。
	 */
	siblingUnknownName: 'きょうだい',
	/** #4509 ①: 経験値行のレベルアップ併記。増分の数値そのものは実データから導出する */
	resultXpLevelUp: (level: number | string) => ` → Lv.${level} ↑`,
	resultMissionComplete: '🎯 ミッションたっせい！',
	resultMissionAllClear: '🎉 ぜんぶクリア！',
	resultTodayCount: (n: number | string) => `きょう ${n}かいめ！`,
	resultCancelButton: (s: number | string) => `とりけし (${s}s)`,
	resultConfirmButton: 'やったね！',
	crossComboBang: '！',

	// #1757 (#1709-C) 「今日のおやくそく」N/M バー
	// preschool は mustTitleKana（ひらがな）、それ以外は mustTitle（漢字）を出し分け
	mustTitle: '今日のおやくそく',
	mustTitleKana: 'きょうのおやくそく',
	/** N/M 形式（labels 側で形成、コンポーネント側でテンプレ直書き禁止） */
	mustProgressText: (logged: number | string, total: number | string) => `${logged}/${total}`,
	/** 部分達成時の残数表示（preschool/それ以外で語彙差なし — 数 + 「こ」のみ） */
	mustRemaining: (n: number | string) => `あと ${n}こ`,
	mustAllComplete: 'ぜんぶできた！',
	mustAllCompleteEmoji: '✨',
	mustBonusGranted: (pts: number | string) => `+${pts}pt`,
	mustBonusGrantedAriaLabel: (pts: number | string) =>
		`今日のおやくそく ぜんぶできた ボーナス ${pts}ポイント`,
} as const;

/**
 * 子供ホームの文言セット。値の型は `string` / 関数に広げてある
 * （リテラル型のままだと年齢帯変種が別の文字列を入れられない）。
 */
type ChildHomeLabels = {
	readonly [K in keyof typeof CHILD_HOME_LABELS]: (typeof CHILD_HOME_LABELS)[K] extends string
		? string
		: (typeof CHILD_HOME_LABELS)[K];
};

/**
 * #4690 F6: 子供ホームの漢字変種 (junior / senior、13-18 歳)。
 *
 * 旧実装は年齢帯を持たず、高校生の画面にも記録ダイアログ「きろくする？ / きろく！ /
 * やめる」、結果「やったね！ / けいけんち / きょう 1かいめ！」、「⭐ おやくそく」が
 * 出ていた (docs/DESIGN.md §8)。差分だけを持ち、ベースに spread で重ねる。
 */
const CHILD_HOME_KANJI_OVERRIDES = {
	completedAriaLabel: (name: string) => `${name}（記録済み）`,
	pinActionUnpin: '📌 ピン留めを外す',
	pinActionPin: '📌 ピン留めする',
	pinCloseButton: '閉じる',
	confirmTitle: (name: string) => `${name}を
記録する？`,
	confirmTitleBr: (name: string) => `${name}を`,
	confirmTitleBrLine2: '記録する？',
	confirmCancelButton: 'キャンセル',
	confirmSubmitLoading: '記録中…',
	confirmSubmitButton: '記録する',
	resultCancelledTitle: '取り消しました',
	resultCancelledClose: '閉じる',
	resultFirstRecord: '🌟 はじめの一歩！ 🌟',
	resultActivityRecorded: (name: string) => `${name}を記録しました`,
	resultStreakBonus: (days: number | string, bonus: number | string) =>
		`${days}日連続！ +${bonus}ボーナス`,
	resultMasteryBonus: (bonus: number | string, level: number | string) =>
		`📗 熟練ボーナス +${bonus} (Lv.${level})`,
	resultMasteryLevelUp: (name: string, level: number | string) =>
		`🎖️ ${name}が Lv.${level} になりました`,
	resultXpLabel: '経験値',
	/** #4916: hiragana 側「きほん」の漢字 override */
	resultBreakdownBase: (points: number | string) => `基本 +${points}P`,
	siblingUnknownName: 'きょうだい',
	resultMissionComplete: '🎯 ミッション達成！',
	resultMissionAllClear: '🎉 すべてクリア！',
	resultTodayCount: (n: number | string) => `今日 ${n}回目`,
	resultCancelButton: (sec: number | string) => `取り消し (${sec}s)`,
	resultConfirmButton: 'OK',
	mustRemaining: (n: number | string) => `あと ${n}件`,
	mustAllComplete: 'すべて達成',
	// #4841: 読み上げ文だけ「ぜんぶできた」が残り、表示 (すべて達成) と文体が割れていた
	mustBonusGrantedAriaLabel: (pts: number | string) =>
		`今日のおやくそく すべて達成 ボーナス ${pts}ポイント`,
} as const satisfies Partial<ChildHomeLabels>;

/** 子供ホームの文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildHomeLabels(uiMode: string): ChildHomeLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') return CHILD_HOME_LABELS;
	return { ...CHILD_HOME_LABELS, ...CHILD_HOME_KANJI_OVERRIDES };
}

export const BABY_HOME_LABELS = {
	pageTitle: '準備モード',
	parentNote: `${PARENT_TERMS.honorific}の方向けの準備ツールです`,
	waitingTitle: '3歳になるまでもう少し！',
	waitingDesc: '自分で入力できるようになるまで、楽しみに待っていてね。',
	ageMonthsLabel: (months: number) => `${months} ヶ月`,
	ageYearsLabel: (years: number) => `${years} 歳`,
	countdownLabel: '3歳まであと',
	countdownMonthsText: (months: number) => `${months} ヶ月`,
	countdownWeeksText: (weeks: number) => `${weeks} 週間`,
	countdownReachedText: 'もうすぐ3歳！年齢モードを変更できます',
	initialPointsTitle: '初期ポイントを設定する',
	initialPointsDesc: '3歳以降に使えるポイントを今から積み立てられます',
	initialPointsLinkLabel: '初期ポイントを設定する',
	currentPoints: (pts: number) => `現在のポイント: ${pts} pt`,
	goToAdmin: `${ADMIN_VIEW_TERMS.canonical}へ`,
	initialPointsPageTitle: '初期ポイント設定',
	initialPointsAmountLabel: 'ポイント数',
	initialPointsAmountHint: '3歳以降のスタートポイントとして追加されます',
	initialPointsSubmit: 'ポイントを追加',
	initialPointsSuccess: 'ポイントを追加しました',
	initialPointsCancel: 'キャンセル',
	initialPointsBackAriaLabel: '戻る',
	initialPointsMinError: '1以上のポイントを入力してください',
	initialPointsMaxError: '10000以下のポイントを入力してください',
} as const;

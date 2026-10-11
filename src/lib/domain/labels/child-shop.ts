// labels 層 (ADR-0045 / #4965): 子供のごほうびショップ。置き場所の規則は docs/DESIGN.md §6
import { CHILD_SHOP_TERMS } from '../terms';
import { normalizeUiMode } from '../validation/age-tier-types';

// ============================================================
// ごほうびショップ 子供側 UI (#1337)
// ============================================================

export const CHILD_SHOP_LABELS = {
	// #4716: 親画面の説明文 (ADMIN_REWARDS_PAGE_LABELS.headerDescription) と同じ atom から引く
	pageTitle: `${CHILD_SHOP_TERMS.pageName}`,
	navLabel: 'ショップ',
	navIcon: '🎁',
	pointBalanceLabel: 'いまのポイント',
	pointUnit: 'ポイント',
	exchangeButton: 'こうかんする',
	exchangeConfirmTitle: (rewardTitle: string, points: number) =>
		`${rewardTitle} と こうかんする？（${points} ポイント）`,
	exchangeConfirmYes: 'はい',
	exchangeConfirmCancel: 'やめる',
	/**
	 * #4509 ②: 不足分は「整形済みの表示文字列」を受け取る。
	 * 生ポイント + 固定単位だと通貨モードで嘘の数字になるため、単位は呼び出し側が
	 * splitPointDisplay で決める。
	 */
	insufficientPointsHint: (remainingText: string) => `あと ${remainingText}`,
	emptyMessage: 'ごほうびがまだありません',
	// #4631: 陳列棚に出すバッジは「承認待ち」だけ。approved / rejected は完了した状態なので
	// カードに残さない (残すと「もう交換できない」と誤解させる)。結果は「記録 > 交換」で読む。
	statusPending: 'うけとりまち',
	// #4631: 交換の結果 (いつ / いくら / 却下理由) を読みに行く導線。
	// 却下理由は親が書いた文章なので、ショップからは辿れないと子供が理由を知る手段が無かった。
	historyLinkLabel: 'こうかんの きろくを みる',
	// 通知 overlay
	approvedTitle: (rewardTitle: string) => `${rewardTitle} もらったよ！`,
	rejectedTitle: (rewardTitle: string) => `${rewardTitle} は ちょっとまってね`,
	overlayCloseButton: 'とじる',
	// aria-labels
	rewardListAriaLabel: 'ごほうびリスト',
	pointProgressAriaLabel: 'ポイント進捗',
	// #2155 Dialog UX 改善: 階層化表示用ラベル
	exchangeConfirmHeading: 'こうかんしますか？',
	exchangeConfirmPointsLabel: 'ひつようなポイント',
	// #4684 F1/F2: 確認ダイアログの説明は「実際に起きること」を言う。
	//   - 即時交換 ON (reward_auto_approve): その場で approved 確定 = ポイントがすぐ減る。
	//   - 承認モード: 申請だけが作られる。push / メール通知の経路は無く、親が /admin を
	//     開いたときに承認待ちバナーで気づく。よって「れんらくがいく」とは言わない。
	exchangeConfirmDescriptionInstant: 'すぐに こうかんするよ（ポイントが へるよ）',
	exchangeConfirmDescriptionApproval: 'おうちのひとが みたら へんじがくるよ',
	exchangeDialogAriaLabel: 'ごほうび交換確認ダイアログ',
	// #2157 ショップ 3 系統タブ (実物 / お小遣い / 特権、26-設計書 §12 + #1336 SSOT 反映)
	// shopCategory key (physical / money / privilege) → 表示ラベル
	// (表示語彙は子供向け hiragana。internal key の 'money' を表示では「おこづかい」と呼ぶ)
	tabAll: 'すべて',
	tabPhysical: 'もの',
	tabAllowance: 'おこづかい',
	tabPrivilege: 'とくべつ',
	tabsAriaLabel: 'ごほうび系統タブ',
	tabEmpty: (categoryLabel: string) => `${categoryLabel} のごほうびは まだないよ`,
	// #2160 カテゴリ・フィルタ (ポイント範囲 + 交換可能チェック、子供向け最小 filter)
	filterPointsRangeLabel: 'ポイントでさがす',
	filterPointsRangeAll: 'ぜんぶ',
	filterPointsRangeLow: '〜100ポイント',
	filterPointsRangeMid: '100〜500ポイント',
	filterPointsRangeHigh: '500ポイント〜',
	filterPointsRangeAriaLabel: 'ポイント範囲フィルタ',
	filterAvailable: 'いまこうかんできる',
	filterAvailableAriaLabel: 'いまのポイントでこうかんできるものだけ表示',
	filterReset: 'リセット',
	filterBadge: (total: number, filtered: number) => `${total}件中 ${filtered}件`,
	filterEmptyMessage: 'じょうけんに あうごほうびが ありません',
	// #4407 個数指定 (単位量のごほうび = 「ゲーム時間 +30分」を 2 時間ぶん = 4 個 交換する)
	quantityLabel: 'いくつ こうかんする？',
	quantityDecreaseAriaLabel: 'こすうを へらす',
	quantityIncreaseAriaLabel: 'こすうを ふやす',
	// stepper ボタンの表示グリフ (全角記号。数字と並べたときに幅が揃う)
	quantityDecreaseGlyph: '−',
	quantityIncreaseGlyph: '＋',
	quantityUnit: 'こ',
	quantityValueAriaLabel: (quantity: number) => `こすう ${quantity}こ`,
	quantityMaxHint: 'もっているポイントで こうかんできる さいだいの こすうだよ',
	totalPointsLabel: 'ぜんぶで',
	// #4509 ②: 単位語 (「ポイント」) を見出しから外す。通貨モードでは値が「250円」になるため、
	// 見出しに「ポイント」が残ると同じ行の中で単位が二重に食い違う。
	remainingAfterLabel: 'こうかんしたあとの のこり',
	// #4407 AC9/AC12: 交換の結果を「見ている場所」に文字で出す (演出は加飾であって通知ではない)
	exchangeSuccessToastTitle: 'こうかんできたよ！',
	exchangeSuccessToastBody: (rewardTitle: string, quantity: number, balance: number) =>
		`${rewardTitle}${quantity > 1 ? ` ${quantity}こ` : ''} ／ のこり ${balance} ポイント`,
	exchangeRequestedToastTitle: 'おうちのひとに おねがいしたよ',
	// #4684 F2: 「へんじを まってね」は待てば通知が来ると読める。実際は親が /admin を開いた
	// ときの承認待ちバナーだけなので、子供が待ちっぱなしにならない言い方にする。
	exchangeRequestedToastBody: (rewardTitle: string, quantity: number) =>
		`${rewardTitle}${quantity > 1 ? ` ${quantity}こ` : ''} ／ おうちのひとが みたら へんじがくるよ`,
	// #4407 AC10: 交換申請が通らなかったときの文言 (状態に合わせて分ける)
	errorInsufficientPoints: 'ポイントが たりないよ',
	errorAlreadyPending: 'いま おうちのひとの へんじを まっているよ',
	errorRecentlyExchanged: 'さっき こうかんしたよ。すこし まってから もういちど おしてね',
	errorRewardNotFound: 'この ごほうびが みつからないよ',
	errorInvalidQuantity: 'こすうを もういちど えらんでね',
	errorChildNotSelected: 'こどもが えらばれていないよ',
	errorGeneric: 'うまく いかなかったよ。もういちど ためしてね',
} as const;

/**
 * ごほうびショップの文言セット。値の型は `string` に広げてある
 * （`as const` のリテラル型のままだと、年齢帯変種が「別の文字列」を入れられない）。
 */
type ChildShopLabels = {
	readonly [K in keyof typeof CHILD_SHOP_LABELS]: (typeof CHILD_SHOP_LABELS)[K] extends string
		? string
		: (typeof CHILD_SHOP_LABELS)[K];
};

/**
 * #4690 F4: ごほうびショップの漢字変種 (junior / senior、13-18 歳)。
 *
 * 旧実装は `CHILD_SHOP_LABELS` をどの年齢帯でも直参照しており、高校生の画面にも
 * 「いまのポイント / こうかんする / おうちのひとにれんらくがいくよ / はい / やめる」が
 * 出ていた (docs/DESIGN.md §8 は junior・senior = 漢字・情報密度高)。
 *
 * **差分だけ**を持ち、ベース (ひらがな) に spread で重ねる。全キーを二重に持つと
 * 片方だけ足す事故が起きるため、変える語だけを列挙する。
 */
export const CHILD_SHOP_KANJI_OVERRIDES = {
	pointBalanceLabel: '現在のポイント',
	exchangeButton: '交換する',
	exchangeConfirmTitle: (rewardTitle: string, points: number) =>
		`${rewardTitle} と交換する？（${points} ポイント）`,
	exchangeConfirmYes: 'はい',
	exchangeConfirmCancel: 'キャンセル',
	insufficientPointsHint: (remainingText: string) => `あと ${remainingText}`,
	emptyMessage: 'ごほうびがまだありません',
	statusPending: '承認待ち',
	// #4631 で approved / rejected バッジは陳列棚から消えた (ベース側にキーが無い) ため
	// override も置かない。結果は「記録 > 交換」で読む。
	historyLinkLabel: '交換の記録を見る',
	approvedTitle: (rewardTitle: string) => `${rewardTitle} を受け取りました`,
	rejectedTitle: (rewardTitle: string) => `${rewardTitle} は保留になりました`,
	overlayCloseButton: '閉じる',
	exchangeConfirmHeading: '交換しますか？',
	exchangeConfirmPointsLabel: '必要なポイント',
	// #4684 の即時交換 / 承認待ちの出し分け文も年齢帯で文体を切り替える (#4690)
	// (旧 `exchangeConfirmDescription` は #4684 が Instant / Approval の 2 文に分けたため、
	//  ベース側に対応キーが無い。override だけ残すと死にキーになるので置かない)
	exchangeConfirmDescriptionInstant: 'すぐに交換します（ポイントが減ります）',
	exchangeConfirmDescriptionApproval: '保護者が確認したら返事がきます',
	tabAll: 'すべて',
	tabPhysical: 'もの',
	tabAllowance: 'おこづかい',
	tabPrivilege: '特別',
	tabEmpty: (categoryLabel: string) => `${categoryLabel} のごほうびはまだありません`,
	filterPointsRangeLabel: 'ポイントで探す',
	filterPointsRangeAll: 'すべて',
	filterAvailable: '今すぐ交換できる',
	filterAvailableAriaLabel: '今のポイントで交換できるものだけ表示',
	filterEmptyMessage: '条件に合うごほうびがありません',
	quantityLabel: 'いくつ交換する？',
	quantityDecreaseAriaLabel: '個数を減らす',
	quantityIncreaseAriaLabel: '個数を増やす',
	quantityUnit: '個',
	quantityValueAriaLabel: (quantity: number) => `個数 ${quantity}個`,
	quantityMaxHint: '持っているポイントで交換できる最大の個数です',
	totalPointsLabel: '合計',
	remainingAfterLabel: '交換したあとの残り',
	exchangeSuccessToastTitle: '交換できました',
	exchangeSuccessToastBody: (rewardTitle: string, quantity: number, balance: number) =>
		`${rewardTitle}${quantity > 1 ? ` ${quantity}個` : ''} ／ 残り ${balance} ポイント`,
	exchangeRequestedToastTitle: '保護者に申請しました',
	exchangeRequestedToastBody: (rewardTitle: string, quantity: number) =>
		`${rewardTitle}${quantity > 1 ? ` ${quantity}個` : ''} ／ 返事を待ってください`,
	errorInsufficientPoints: 'ポイントが足りません',
	errorAlreadyPending: '保護者の返事を待っています',
	errorRecentlyExchanged: 'さきほど交換しました。少し待ってからもう一度押してください',
	errorRewardNotFound: 'このごほうびが見つかりません',
	errorInvalidQuantity: '個数をもう一度選んでください',
	errorChildNotSelected: '子供が選ばれていません',
	errorGeneric: 'うまくいきませんでした。もう一度試してください',
} as const satisfies Partial<ChildShopLabels>;

/** ごほうびショップの文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildShopLabels(uiMode: string): ChildShopLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') return CHILD_SHOP_LABELS;
	return { ...CHILD_SHOP_LABELS, ...CHILD_SHOP_KANJI_OVERRIDES };
}

// labels 層 (ADR-0045 / #4965): チュートリアル (親子共通の TutorialOverlay を含む) / 子供の ❓。置き場所の規則は docs/DESIGN.md §6
import { PARENT_TERMS } from '../terms';
// #4652 / #4715: 子供チュートリアルの nav 名 / とりけし秒数は画面と同じ SSOT から引く。
//   年齢モード別 nav ラベルの SSOT は `getChildNavModeLabels()` (旧 icons.ts の getModeLabels)。
import { CANCEL_WINDOW_MS } from '../validation/activity';
import { normalizeUiMode } from '../validation/age-tier-types';
import { CHILD_SHOP_KANJI_OVERRIDES, CHILD_SHOP_LABELS } from './child-shop';
import { CHILD_NAV_MODE_LABELS, getChildNavModeLabels } from './nav';

// ============================================================
// チュートリアル（子供画面ガイド）の共通ダイアログ文言
// ============================================================
//
// #4654 (EPIC #4650 判断 2): 親の章立てチュートリアル (v1) 撤去に伴い、章立て専用 key
// (viewFullGuide / openGuide / quick* = クイックモード) を削除した。本定数は
// 再開 / 終了確認ダイアログの既定文言のみを持つ。子供画面は年齢帯 variant
// (`getChildTutorialLabels(uiMode).dialog`、#4652) を使うため、本既定値は
// `childUiMode` 未指定の呼び出し (将来の親向け再利用) 用のフォールバックである。

export const TUTORIAL_LABELS = {
	/** #1192: 再開プロンプト */
	resumeTitle: 'チュートリアルの続き',
	resumePrompt: '前回の途中から続けますか？',
	resumeCancel: 'キャンセル',
	resumeFromStart: '最初から',
	resumeContinue: '続きから',
	/** #1192: 終了確認ダイアログ */
	exitConfirmAriaLabel: 'チュートリアル終了確認',
	exitConfirmPrompt: 'チュートリアルを終了しますか？',
	exitConfirmHint: '進捗は保存されるので、後から続きを再開できます。',
	exitConfirmCancel: '続ける',
	exitConfirmConfirm: '終了する',
} as const;

// ============================================================
// 子供チュートリアル（子供ホーム ❓）の文言 SSOT（#4652、EPIC #4650 判断 3 / 4 / 5）
// ============================================================
//
// 「記録して閉じる」最短経路だけを説明する（ADR-0012）: 活動カード → とりけし → 💮 スタンプ → 下ナビ
// （つよさ / ステータス、ショップ）。ホームに無い仕組み（コンボ / おみくじ / 別ページのレーダー
// チャート）は説明しない。
//
// 年齢帯 variant: preschool / elementary = ひらがな分かち書き、junior / senior = 漢字（nav ラベルと同表記）。
// nav 名は `getChildNavModeLabels(uiMode).status` / `CHILD_SHOP_LABELS.navLabel`、とりけし秒数は
// `CANCEL_WINDOW_MS` を参照し、画面の実表記・実値と一致させる（直書きしない）。
// 関数にしているのは CHILD_SHOP_LABELS 等の宣言順（TDZ）に依らず参照するため。

/**
 * 子供チュートリアルの文言 variant。preschool / elementary = kana、junior / senior = kanji。
 * 外部公開せず本ファイル内で `getChildTutorialLabels` からのみ使う (公開 API は同関数 1 本)。
 */
type ChildTutorialVariant = 'kana' | 'kanji';

function getChildTutorialVariant(uiMode: string): ChildTutorialVariant {
	return uiMode === 'junior' || uiMode === 'senior' ? 'kanji' : 'kana';
}

export function getChildTutorialLabels(uiMode: string) {
	const variant = getChildTutorialVariant(uiMode);
	// #4652 の意図 (チュートリアルの nav 名を画面と同じ SSOT から引く) はそのまま。
	// #4715 で年齢モード別 nav ラベルの SSOT が icons.ts から labels 層 (`getChildNavModeLabels()`) へ移ったので参照先を合わせる。
	const mode = getChildNavModeLabels(uiMode);
	const statusNav = mode.status;
	const shopNav = CHILD_SHOP_LABELS.navLabel;
	const cancelSec = Math.round(CANCEL_WINDOW_MS / 1000);
	if (variant === 'kanji') {
		return {
			variant,
			chapters: {
				record: { title: '記録しよう', icon: '⭐' },
				daily: { title: '毎日つづけよう', icon: '🎴' },
				more: { title: 'ほかの画面', icon: '📊' },
			},
			steps: {
				'child-record-card': {
					title: '活動カード',
					description:
						'やったことのカードをタップすると「きろく！」ボタンが出ます。きろく！ を押すとポイントがもらえます。',
				},
				// ホーム以外の画面 (チェックリスト等) で開いたとき用 (#4860)。
				// その画面に活動カードは無く、件数も分からない。**あるとも無いとも言わない** —
				// 「タップして」も「まだ届いていません」もそこでは嘘になりうる。
				//
				// 「ホームに戻ると そこから記録できます」とは言わない (adversarial 指摘)。
				// 活動 0 件の子には、戻った先で「活動がまだ届いていません」が出る。
				// カードの存在も記録できることも約束せず、**その機能がどの画面にあるか**だけを言う。
				'child-record-card-elsewhere': {
					title: '活動カード',
					description: '活動の記録はホーム画面で行います。ホームに戻って確かめてみてください。',
				},
				// 活動 0 件のとき用。カードが 1 枚も無い画面で「カードをタップすると」と案内し、
				// 光らせる先も無いのは、初回演出と同じ「無いものを指す」欠陥になる。
				'child-record-card-empty': {
					title: '活動カード',
					description: `活動がまだ届いていません。${PARENT_TERMS.honorific}が活動を用意すると、ここにカードが並びます。`,
				},
				'child-record-cancel': {
					title: 'とりけし',
					description: `まちがえて記録しても、記録のあと ${cancelSec} 秒のあいだは「とりけし」ボタンで取り消せます。`,
				},
				'child-daily-stamp': {
					title: 'スタンプ',
					description:
						'毎日ひらくと 💮 スタンプがたまります。タップするとスタンプカードが見られます。',
				},
				'child-nav-status': {
					title: statusNav,
					description: `下の「${statusNav}」で、自分の成長（5 つの力）が見られます。`,
				},
				'child-nav-shop': {
					title: shopNav,
					description: `ためたポイントは下の「${shopNav}」でごほうびに交換できます。`,
				},
			},
			dialog: {
				resumeTitle: 'ガイドの続き',
				resumePrompt: '前回の途中から続けますか？',
				resumeCancel: 'やめる',
				resumeFromStart: '最初から',
				resumeContinue: '続きから',
				exitConfirmAriaLabel: 'ガイド終了の確認',
				exitConfirmPrompt: 'ガイドを終了しますか？',
				exitConfirmHint: '途中からあとで再開できます。',
				exitConfirmCancel: '続ける',
				exitConfirmConfirm: '終了する',
			},
		} as const;
	}
	return {
		variant,
		chapters: {
			record: { title: 'きろくしよう', icon: '⭐' },
			daily: { title: 'まいにち つづけよう', icon: '🎴' },
			more: { title: 'ほかの がめん', icon: '📊' },
		},
		steps: {
			'child-record-card': {
				title: 'かつどうカード',
				description:
					'やったことの カードを タップすると「きろく！」ボタンが でるよ。きろく！ を おすと ポイントが もらえるよ。',
			},
			// ホーム以外の画面で開いたとき用 (漢字側と同じ理由。あるとも無いとも言わない)。
			// 「もどると きろくできるよ」と約束しない — 0 件の子には戻った先で
			// 「かつどうが まだ とどいてないよ」が出る。場所だけを言う。
			'child-record-card-elsewhere': {
				title: 'かつどうカード',
				description: 'かつどうの きろくは ホームの がめんで するよ。ホームに もどって みてね。',
			},
			// 活動 0 件のとき用 (漢字側と同じ理由。無いものを指さない)。
			'child-record-card-empty': {
				title: 'かつどうカード',
				description: 'かつどうが まだ とどいてないよ。おうちの人が よういすると ここに ならぶよ。',
			},
			'child-record-cancel': {
				title: 'とりけし',
				description: `まちがえて きろくしても、きろくの あと ${cancelSec}びょうの あいだは「とりけし」ボタンで とりけせるよ。`,
			},
			'child-daily-stamp': {
				title: 'スタンプ',
				description:
					'まいにち ひらくと 💮 スタンプが たまるよ。タップすると スタンプカードが みられるよ。',
			},
			'child-nav-status': {
				title: statusNav,
				description: `したの「${statusNav}」で、じぶんの つよさ（5つの ちから）が みられるよ。`,
			},
			'child-nav-shop': {
				title: shopNav,
				description: `ためた ポイントは したの「${shopNav}」で ごほうびに かえられるよ。`,
			},
		},
		dialog: {
			resumeTitle: 'ガイドの つづき',
			resumePrompt: 'まえの つづきから みる？',
			resumeCancel: 'やめる',
			resumeFromStart: 'さいしょから',
			resumeContinue: 'つづきから',
			exitConfirmAriaLabel: 'ガイドを やめる かくにん',
			exitConfirmPrompt: 'ガイドを やめる？',
			exitConfirmHint: 'あとで つづきから みられるよ。',
			exitConfirmCancel: 'つづける',
			exitConfirmConfirm: 'やめる',
		},
	} as const;
}

// ============================================================
// 子供画面の ❓ ページガイド（ホーム以外の画面、#4864 / EPIC #4650）
// ============================================================
//
// PO 決裁 (2026-09-23) 案 1: 子供の ❓ は **押した画面** について説明する (親の ❓ ページガイドと
// 同じ意味)。説明を用意しない画面では ❓ を出さない。1 画面あたり 1〜3 step。
// ホームの ❓ は `getChildTutorialLabels` (3 章 5 step) をそのまま使う。本定数はホーム以外の画面用。
//
// 年齢帯 variant は src/routes/CLAUDE.md §年齢帯 variant の override 方式: ひらがな
// (baby / preschool / elementary) を base にし、junior / senior は漢字の差分だけを spread で重ねる。
// ボタン名・リンク名・nav 名は画面と同じ定数から引く (画面の表記とガイドの表記をずらさない)。
//
// 「その画面で実際に起きること」だけを書く:
//   - チェックリストのポイントは **全部そろえたときだけ** 付く (checklist-service は全完了時にだけ台帳へ書く)
//   - ショップの交換は即時交換 / 保護者の承認待ちの 2 通りがある → どちらでも正しい「押せる条件」だけを言う
//   - ステータスの減衰は家庭の設定で無効にできる → 「へる」とは書かない

const CHILD_PAGE_GUIDE_LABELS = {
	// ---- チェックリスト (/checklist) ----
	checklistChapterTitle: CHILD_NAV_MODE_LABELS.preschool.checklist,
	checklistChapterIcon: '📋',
	checklistCheckTitle: 'チェックの しかた',
	checklistCheckDesc:
		'そろえた ものを タップすると ✅ が つくよ。まちがえたら もう いちど タップすると もどせるよ。',
	checklistPointsTitle: 'ぜんぶ そろったら',
	checklistPointsDesc: 'リストの ものを ぜんぶ ✅ に すると ポイントが もらえるよ。',
	// チェックする項目が 1 つも無いとき用 (無いものを指さない、#4860 と同じ理由)
	checklistEmptyTitle: CHILD_NAV_MODE_LABELS.preschool.checklist,
	checklistEmptyDesc:
		'チェックする ものが まだ ないよ。おうちの ひとが よういすると ここに ならぶよ。',
	// ---- ショップ (/<uiMode>/shop) ----
	shopChapterTitle: CHILD_SHOP_LABELS.navLabel,
	shopChapterIcon: CHILD_SHOP_LABELS.navIcon,
	shopExchangeTitle: 'ごほうびと こうかん',
	shopExchangeDesc: `ためた ポイントで ごほうびと こうかんできるよ。ポイントが たりると「${CHILD_SHOP_LABELS.exchangeButton}」が おせるよ。`,
	// ごほうびが 1 つも無いとき用
	shopEmptyTitle: 'ごほうび',
	shopEmptyDesc: 'ごほうびが まだ ないよ。おうちの ひとが よういすると ここに ならぶよ。',
	shopHistoryTitle: 'こうかんの きろく',
	shopHistoryDesc: `こうかんした きろくは「${CHILD_SHOP_LABELS.historyLinkLabel}」で みられるよ。`,
	// ---- つよさ / ステータス (/<uiMode>/status) ----
	statusChapterTitle: CHILD_NAV_MODE_LABELS.preschool.status,
	statusChapterIcon: '📊',
	statusGrowthTitle: 'ちからの のばしかた',
	statusGrowthDesc: 'かつどうを きろくすると、その しゅるいの ちからが のびるよ。',
	statusLevelTitle: 'レベル',
	statusLevelDesc: 'ちからが たまると レベルが あがるよ。',
} as const;

/**
 * 子供ページガイドの文言セット。値の型は `string` に広げてある
 * （`as const` のリテラル型のままだと、漢字変種が別の文字列を入れられない）。
 */
type ChildPageGuideLabels = {
	readonly [K in keyof typeof CHILD_PAGE_GUIDE_LABELS]: string;
};

/** junior / senior (13-18 歳) の漢字変種。差分だけを持ち、ベースに spread で重ねる。 */
const CHILD_PAGE_GUIDE_KANJI_OVERRIDES = {
	checklistCheckTitle: 'チェックの仕方',
	checklistCheckDesc:
		'そろえた物をタップすると ✅ が付きます。間違えたときは、もう一度タップすると外せます。',
	checklistPointsTitle: '全部そろったら',
	checklistPointsDesc: 'リストの項目をすべて ✅ にすると、ポイントがもらえます。',
	checklistEmptyDesc: `チェックする項目はまだありません。${PARENT_TERMS.honorific}が用意すると、ここに並びます。`,
	shopExchangeTitle: 'ごほうびと交換',
	shopExchangeDesc: `ためたポイントで、ごほうびと交換できます。ポイントが足りると「${CHILD_SHOP_KANJI_OVERRIDES.exchangeButton}」を押せます。`,
	shopEmptyDesc: `ごほうびはまだありません。${PARENT_TERMS.honorific}が用意すると、ここに並びます。`,
	shopHistoryTitle: '交換の記録',
	shopHistoryDesc: `交換した記録は「${CHILD_SHOP_KANJI_OVERRIDES.historyLinkLabel}」で見られます。`,
	statusChapterTitle: CHILD_NAV_MODE_LABELS.senior.status,
	statusGrowthTitle: '力の伸ばし方',
	statusGrowthDesc: '活動を記録すると、その種類の力が伸びます。',
	statusLevelDesc: '力がたまると、レベルが上がります。',
} as const satisfies Partial<ChildPageGuideLabels>;

/** 子供ページガイド (ホーム以外) の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildPageGuideLabels(uiMode: string): ChildPageGuideLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') {
		return CHILD_PAGE_GUIDE_LABELS;
	}
	return { ...CHILD_PAGE_GUIDE_LABELS, ...CHILD_PAGE_GUIDE_KANJI_OVERRIDES };
}

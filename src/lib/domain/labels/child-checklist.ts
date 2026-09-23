// labels 層 (ADR-0045 / #4965): 子供のチェックリスト画面。置き場所の規則は docs/DESIGN.md §6
import { PARENT_TERMS, WEEKDAY_NAMES_SUNDAY_FIRST } from '../terms';
import { normalizeUiMode, type UiMode } from '../validation/age-tier-types';

/**
 * チェックリスト画面の文言 (年齢帯 variant)。
 *
 * #4509 ④/⑥: 以前は 1 セットのひらがな文言しか無く、13-18 歳がナビの「持ち物チェック」(漢字)
 * から遷移すると「にちようび」「おやにおねがいしてね」という幼児文体に着地していた。
 * 曜日名 7 件 / 時間帯 4 件も画面側に直書きされていた。
 *
 * 年齢帯の出し分けは `getChildChecklistLabels({ ageTier })` 経由に集約する
 * (`src/routes/CLAUDE.md` §年齢帯 variant: 画面側に `if (uiMode === ...)` を散らさない)。
 * 分割は MODE_VARIANTS (child-home) と同じ baby/preschool = ひらがな、
 * elementary 以上 = 漢字。
 */
interface ChildChecklistTextVariant {
	todayPrefix: string;
	nowPrefix: string;
	nowSuffix: string;
	emptyTitle: string;
	emptyDesc: string;
	completedAll: string;
	checkForPoints: string;
	completeTitle: string;
	completeMsg: string;
	completeButton: string;
	/** 曜日名 (index 0 = 日曜)。JST SSOT (`jstDayOfWeek()`) の戻り値で引く */
	dayNames: readonly string[];
	/** 時間帯ラベル (checklist.timeSlot の値で引く) */
	timeSlotLabels: Readonly<Record<string, string>>;
}

const CHILD_CHECKLIST_HIRAGANA: ChildChecklistTextVariant = {
	todayPrefix: 'きょうは',
	nowPrefix: 'いまは',
	nowSuffix: 'のじかん',
	emptyTitle: 'チェックリストがないよ',
	emptyDesc: 'おやにおねがいしてね',
	completedAll: '🎉 ぜんぶできた！',
	checkForPoints: 'ぜんぶチェックしたら',
	// #2196: backButton 撤廃 — BottomNav と動線重複 + 他 child タブ (achievements / battle / history / status / shop) 統一性
	completeTitle: 'ぜんぶできたよ！',
	completeMsg: 'わすれものなし！すごい！',
	completeButton: 'やったね！',
	dayNames: [
		'にちようび',
		'げつようび',
		'かようび',
		'すいようび',
		'もくようび',
		'きんようび',
		'どようび',
	],
	timeSlotLabels: {
		morning: 'あさ',
		afternoon: 'ひる',
		evening: 'よる',
		anytime: 'いつでも',
	},
};

const CHILD_CHECKLIST_KANJI: ChildChecklistTextVariant = {
	todayPrefix: '今日は',
	nowPrefix: '今は',
	nowSuffix: 'の時間',
	emptyTitle: 'チェックリストがありません',
	emptyDesc: 'おうちの人に追加してもらおう',
	completedAll: '🎉 全部できた！',
	checkForPoints: '全部チェックしたら',
	completeTitle: '全部できた！',
	completeMsg: '忘れ物なし！すごい！',
	completeButton: 'やったね！',
	dayNames: [...WEEKDAY_NAMES_SUNDAY_FIRST],
	timeSlotLabels: {
		morning: '朝',
		afternoon: '昼',
		evening: '夜',
		anytime: 'いつでも',
	},
};

/** 時間帯アイコン。年齢帯で変わらないため variant の外に置く */
export const CHILD_CHECKLIST_TIME_SLOT_ICONS: Readonly<Record<string, string>> = {
	morning: '☀️',
	afternoon: '🌤️',
	evening: '🌙',
	anytime: '🕐',
};

/**
 * 13-18 歳 (junior / senior) の変種。漢字変種の上に差分だけを重ねる。
 *
 * elementary 向けの漢字変種には「やったね！」「おうちの人に追加してもらおう」という
 * 年少者向けの言い回しが残っており、中高生の画面がそのまま着地していた (docs/DESIGN.md §8)。
 */
const CHILD_CHECKLIST_TEEN_OVERRIDES = {
	emptyDesc: `${PARENT_TERMS.honorific}に追加してもらおう`,
	completedAll: '🎉 全部達成！',
	completeTitle: '全部達成！',
	completeMsg: '忘れ物なし！',
	completeButton: 'OK',
} as const satisfies Partial<ChildChecklistTextVariant>;

/**
 * 年齢帯に応じたチェックリスト文言を返す。
 *
 * `ageTier` は必ず呼び出し側から渡すこと (アンチパターン A1: `if (uiMode === 'baby')` 散在の回避)。
 * `(child)/+layout.server.ts` が解決した `data.uiMode` をそのまま渡す。
 */
export function getChildChecklistLabels(ctx: {
	ageTier: UiMode | string | null | undefined;
}): ChildChecklistTextVariant {
	const tier = normalizeUiMode(ctx.ageTier ?? '');
	if (tier === 'baby' || tier === 'preschool') return CHILD_CHECKLIST_HIRAGANA;
	if (tier === 'junior' || tier === 'senior') {
		return { ...CHILD_CHECKLIST_KANJI, ...CHILD_CHECKLIST_TEEN_OVERRIDES };
	}
	return CHILD_CHECKLIST_KANJI;
}

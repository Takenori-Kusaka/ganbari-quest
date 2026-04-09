/**
 * 年齢モード別バリアント設定
 *
 * 各年齢モードで異なるテキスト表現とフィーチャーフラグを管理する。
 * baby/preschool = ひらがなメイン、elementary/junior/senior = 漢字メイン
 */
import type { UiMode } from '$lib/domain/validation/age-tier';

/** テキストバリアント: 年齢別のラベル・テキスト */
export interface TextVariant {
	// History page
	historyTabToday: string;
	historyTabWeek: string;
	historyTabMonth: string;
	historyTitle: string;
	historyTotalLabel: string;
	historyCountUnit: string;
	historyEmpty: string;
	historyStreakSuffix: string;
	weekdays: string[];

	// Achievements page
	achievementsWeeklyTitle: string;
	achievementsClearText: string;
	achievementsPastTitle: string;
	achievementsStatusDone: string;
	achievementsStatusActive: string;
	achievementsEmpty: string;
	achievementsEmptyHint: string;

	// Status page
	statusTrendUp: string;
	statusTrendDown: string;
	statusTrendNeutral: string;
}

/** フィーチャーフラグ: 年齢別の有効機能 */
export interface FeatureFlags {
	/** 前月比較チャート表示 */
	showComparison: boolean;
	/** トレンドメッセージ表示 */
	showTrends: boolean;
	/** きょうだい機能（ランキング、応援等） */
	showSiblingFeatures: boolean;
	/** イベントバナー表示 */
	showEvents: boolean;
	/** チェックリスト表示 */
	showChecklists: boolean;
	/** アクティビティピン機能 */
	showPin: boolean;
	/** 親からのメッセージ */
	showParentMessages: boolean;
	/** 記録確認ダイアログ */
	showConfirmDialog: boolean;
	/** 冒険開始オーバーレイ */
	showAdventureStart: boolean;
}

export interface ModeVariant {
	text: TextVariant;
	features: FeatureFlags;
}

const HIRAGANA_TEXT: TextVariant = {
	historyTabToday: 'きょう',
	historyTabWeek: 'しゅう',
	historyTabMonth: 'つき',
	historyTitle: 'きろく',
	historyTotalLabel: 'ごうけい',
	historyCountUnit: 'かい',
	historyEmpty: 'まだきろくがないよ',
	historyStreakSuffix: 'にちれんぞく',
	weekdays: ['にち', 'げつ', 'か', 'すい', 'もく', 'きん', 'ど'],

	achievementsWeeklyTitle: 'こんしゅうの チャレンジ',
	achievementsClearText: 'クリア！ おめでとう！',
	achievementsPastTitle: 'いままでの チャレンジ',
	achievementsStatusDone: 'おわり',
	achievementsStatusActive: 'チャレンジちゅう',
	achievementsEmpty: 'まだ チャレンジきろくが ないよ',
	achievementsEmptyHint: 'チャレンジが はじまったら ここに きろくされるよ',

	statusTrendUp: '🌟 まえよりのびたよ！',
	statusTrendDown: '💪 つぎはもっとがんばろう！',
	statusTrendNeutral: '😊 いいちょうしだよ！',
};

const KANJI_TEXT: TextVariant = {
	historyTabToday: '今日',
	historyTabWeek: '週間',
	historyTabMonth: '月間',
	historyTitle: '記録',
	historyTotalLabel: '合計',
	historyCountUnit: '回',
	historyEmpty: 'まだ記録がないよ',
	historyStreakSuffix: '日連続',
	weekdays: ['日', '月', '火', '水', '木', '金', '土'],

	achievementsWeeklyTitle: '今週のチャレンジ',
	achievementsClearText: 'クリア！おめでとう！',
	achievementsPastTitle: 'これまでのチャレンジ',
	achievementsStatusDone: 'しゅうりょう',
	achievementsStatusActive: 'ちゃれんじ中',
	achievementsEmpty: 'まだチャレンジきろくがないよ',
	achievementsEmptyHint: 'チャレンジが始まったらここに記録されるよ',

	statusTrendUp: '🌟 前よりのびたよ！',
	statusTrendDown: '💪 次はもっとがんばろう！',
	statusTrendNeutral: '😊 いい調子だよ！',
};

const BABY_FEATURES: FeatureFlags = {
	showComparison: false,
	showTrends: false,
	showSiblingFeatures: false,
	showEvents: false,
	showChecklists: false,
	showPin: false,
	showParentMessages: false,
	showConfirmDialog: false,
	showAdventureStart: false,
};

const FULL_FEATURES: FeatureFlags = {
	showComparison: true,
	showTrends: true,
	showSiblingFeatures: true,
	showEvents: true,
	showChecklists: true,
	showPin: true,
	showParentMessages: true,
	showConfirmDialog: true,
	showAdventureStart: true,
};

export const MODE_VARIANTS: Record<UiMode, ModeVariant> = {
	baby: { text: HIRAGANA_TEXT, features: BABY_FEATURES },
	preschool: { text: HIRAGANA_TEXT, features: FULL_FEATURES },
	elementary: { text: KANJI_TEXT, features: FULL_FEATURES },
	junior: { text: KANJI_TEXT, features: FULL_FEATURES },
	senior: { text: KANJI_TEXT, features: FULL_FEATURES },
};

/** 現在のモードのバリアント設定を取得 */
export function getModeVariant(mode: UiMode): ModeVariant {
	return MODE_VARIANTS[mode];
}

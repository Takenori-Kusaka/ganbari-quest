// src/lib/domain/icons.ts
// #0289: アイコン・ラベル定数の一元管理
// 新しいアイコンを追加する際は必ずこのファイルの定数を使用すること。

// ============================================================
// ナビゲーションアイコン
// ============================================================

/** ホーム画面 */
export const ICON_HOME = '🏠';
/** つよさ / ステータス */
export const ICON_STATUS = '⭐';
/** きろく / 記録（履歴） */
export const ICON_HISTORY = '📋';
/** じっせき / 実績 */
export const ICON_ACHIEVEMENTS = '🏆';
/** きりかえ / 切替 */
export const ICON_SWITCH = '🔄';

// ============================================================
// セクション・機能アイコン
// ============================================================

/** 今日の記録サマリー */
export const ICON_RECORD_SUMMARY = '📝';
/** しょうごう / 称号 */
export const ICON_TITLES = '🎖️';
/** ポイント */
export const ICON_POINTS = '⭐';
/** スタンプ */
export const ICON_STAMP = '💮';

// ============================================================
// 年齢モード別ラベル
// ============================================================

export interface ModeLabels {
	status: string;
	switch: string;
	history: string;
	achievements: string;
	titles: string;
	recordSummary: string;
	checklist: string;
}

/** 年齢モード別ラベル定義 */
export const MODE_LABELS: Record<string, ModeLabels> = {
	baby: {
		status: 'つよさ',
		switch: 'きりかえ',
		history: 'きろく',
		achievements: 'じっせき',
		titles: 'しょうごう',
		recordSummary: 'きょうの きろく',
		checklist: 'もちものチェック',
	},
	kinder: {
		status: 'つよさ',
		switch: 'きりかえ',
		history: 'きろく',
		achievements: 'じっせき',
		titles: 'しょうごう',
		recordSummary: 'きょうの きろく',
		checklist: 'もちものチェック',
	},
	lower: {
		status: 'つよさ',
		switch: 'きりかえ',
		history: '記録',
		achievements: '実績',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: '持ち物チェック',
	},
	upper: {
		status: 'ステータス',
		switch: '切り替え',
		history: '記録',
		achievements: '実績',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: '持ち物チェック',
	},
	teen: {
		status: 'ステータス',
		switch: '切り替え',
		history: '記録',
		achievements: '実績',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: '持ち物チェック',
	},
};

const DEFAULT_LABELS: ModeLabels = MODE_LABELS.kinder as ModeLabels;

/** モード別ラベルを安全に取得 */
export function getModeLabels(uiMode: string): ModeLabels {
	return MODE_LABELS[uiMode] ?? DEFAULT_LABELS;
}

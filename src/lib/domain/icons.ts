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
/** チャレンジきろく */
export const ICON_ACHIEVEMENTS = '🏆';
/** もちものチェック / チェックリスト */
export const ICON_CHECKLIST = '📋';
/** かぞく / メンバー（子供選択） */
export const ICON_SWITCH = '👨‍👩‍👧‍👦';

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

/** 年齢モード別ラベル定義（#537: 新コード名に対応） */
const MODE_LABELS: Record<string, ModeLabels> = {
	baby: {
		status: 'つよさ',
		switch: 'かぞく',
		history: 'きろく',
		achievements: 'チャレンジきろく',
		titles: 'しょうごう',
		recordSummary: 'きょうの きろく',
		checklist: 'もちものチェック',
	},
	preschool: {
		status: 'つよさ',
		switch: 'かぞく',
		history: 'きろく',
		achievements: 'チャレンジきろく',
		titles: 'しょうごう',
		recordSummary: 'きょうの きろく',
		checklist: 'もちものチェック',
	},
	elementary: {
		status: 'つよさ',
		switch: 'かぞく',
		history: '記録',
		achievements: 'チャレンジきろく',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: '持ち物チェック',
	},
	junior: {
		status: 'ステータス',
		switch: 'メンバー',
		history: '記録',
		achievements: 'チャレンジきろく',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: '持ち物チェック',
	},
	senior: {
		status: 'ステータス',
		switch: 'メンバー',
		history: '記録',
		achievements: 'チャレンジきろく',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: '持ち物チェック',
	},
};

const DEFAULT_LABELS: ModeLabels = MODE_LABELS.preschool as ModeLabels;

/** モード別ラベルを安全に取得 */
export function getModeLabels(uiMode: string): ModeLabels {
	return MODE_LABELS[uiMode] ?? DEFAULT_LABELS;
}

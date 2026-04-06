// src/lib/domain/labels.ts
// UI表示ラベルの Single Source of Truth
// 全コンポーネントはこのファイルからラベルをインポートして使用する

import type { UiMode } from './validation/age-tier';

// ============================================================
// 年齢区分ラベル
// ============================================================

/** 年齢区分の正式ラベル（プロフィール・設定画面向け） */
export const AGE_TIER_LABELS: Record<UiMode, string> = {
	baby: '赤ちゃん (0〜2歳)',
	kinder: '幼児 (3〜5歳)',
	lower: '小学生 (6〜9歳)',
	upper: '高学年 (10〜14歳)',
	teen: '中高生 (15歳〜)',
};

/** 年齢区分の短縮ラベル（一覧表示・コンパクト表示向け） */
export const AGE_TIER_SHORT_LABELS: Record<UiMode, string> = {
	baby: '0〜2歳',
	kinder: '3〜5歳',
	lower: '6〜9歳',
	upper: '10〜14歳',
	teen: '15歳〜',
};

/** 年齢区分ラベルを取得（不明な値はそのまま返す） */
export function getAgeTierLabel(mode: string): string {
	return AGE_TIER_LABELS[mode as UiMode] ?? mode;
}

/** 年齢区分の短縮ラベルを取得 */
export function getAgeTierShortLabel(mode: string): string {
	return AGE_TIER_SHORT_LABELS[mode as UiMode] ?? mode;
}

// ============================================================
// プラン名
// ============================================================

export type PlanKey = 'free' | 'standard' | 'family';

/** プラン正式名称 */
export const PLAN_LABELS: Record<PlanKey, string> = {
	free: '無料プラン',
	standard: 'スタンダードプラン',
	family: 'ファミリープラン',
};

/** プラン短縮名称（ヘッダー・バッジ等） */
export const PLAN_SHORT_LABELS: Record<PlanKey, string> = {
	free: '無料',
	standard: 'スタンダード',
	family: 'ファミリー',
};

/** プランラベルを取得 */
export function getPlanLabel(tier: string): string {
	return PLAN_LABELS[tier as PlanKey] ?? tier;
}

/** プラン短縮ラベルを取得 */
export function getPlanShortLabel(tier: string): string {
	return PLAN_SHORT_LABELS[tier as PlanKey] ?? tier;
}

// ============================================================
// テーマカラー
// ============================================================

export type ThemeKey = 'pink' | 'blue' | 'green' | 'orange' | 'purple';

/** テーマカラーの日本語ラベル */
export const THEME_LABELS: Record<ThemeKey, string> = {
	pink: 'ピンク',
	blue: 'ブルー',
	green: 'みどり',
	orange: 'オレンジ',
	purple: 'むらさき',
};

/** テーマカラーの絵文字 */
export const THEME_EMOJIS: Record<ThemeKey, string> = {
	pink: '🩷',
	blue: '💙',
	green: '💚',
	orange: '🧡',
	purple: '💜',
};

/** テーマラベルを取得（絵文字 + 日本語名） */
export function getThemeLabel(theme: string): string {
	const key = theme as ThemeKey;
	const emoji = THEME_EMOJIS[key] ?? '🩷';
	const label = THEME_LABELS[key] ?? theme;
	return `${emoji} ${label}`;
}

/** テーマ選択肢一覧を取得 */
export function getThemeOptions(): { value: ThemeKey; label: string; emoji: string }[] {
	return (Object.keys(THEME_LABELS) as ThemeKey[]).map((key) => ({
		value: key,
		label: THEME_LABELS[key],
		emoji: THEME_EMOJIS[key],
	}));
}

// ============================================================
// ナビゲーションカテゴリ
// ============================================================

/** ナビカテゴリのID */
export type NavCategoryId = 'monitor' | 'encourage' | 'customize' | 'settings';

/** ナビカテゴリラベル */
export const NAV_CATEGORY_LABELS: Record<NavCategoryId, string> = {
	monitor: '記録・分析',
	encourage: '応援・報酬',
	customize: '活動設定',
	settings: 'アカウント',
};

// ============================================================
// 機能名
// ============================================================

/** 機能の正式名称 */
export const FEATURE_LABELS = {
	report: 'レポート',
	growthBook: 'グロースブック',
	challengeHistory: 'チャレンジ履歴',
	points: 'ポイント',
	messages: 'おうえんメッセージ',
	rewards: 'ごほうび',
	activities: '活動管理',
	checklists: 'チェックリスト',
	events: 'イベント',
	challenges: 'チャレンジ',
	children: 'こども',
	settings: '設定',
	plan: 'プラン',
	members: 'メンバー',
	dataExport: 'データエクスポート',
} as const;

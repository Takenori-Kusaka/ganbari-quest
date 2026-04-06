// src/lib/domain/labels.ts
// 用語辞書 — UI表示ラベルの Single Source of Truth
// 全てのUIラベルはこのファイルからインポートすること。ハードコード禁止。

import type { UiMode } from './validation/age-tier';

// ============================================================
// ナビゲーションカテゴリ
// ============================================================

export const NAV_CATEGORIES = {
	monitor: { label: '記録・分析', icon: '📊' },
	encourage: { label: '応援・報酬', icon: '💬' },
	customize: { label: '活動設定', icon: '🎮' },
	settings: { label: 'アカウント', icon: '⚙️' },
} as const;

export type NavCategoryId = keyof typeof NAV_CATEGORIES;

// ============================================================
// ナビゲーション項目ラベル
// ============================================================

export const NAV_ITEM_LABELS = {
	reports: 'レポート',
	growthBook: 'グロースブック',
	achievements: 'チャレンジ履歴',
	points: 'ポイント',
	messages: 'おうえん',
	rewards: 'ごほうび',
	activities: '活動管理',
	checklists: 'チェックリスト',
	events: 'イベント',
	challenges: 'チャレンジ',
	children: 'こども',
	settings: '設定',
	license: 'プラン',
	members: 'メンバー',
} as const;

// ============================================================
// 年齢区分ラベル（管理画面用）
// ============================================================

/** 管理画面で保護者に表示する年齢区分ラベル（#537: 日本の学校制度に準拠） */
export const AGE_TIER_LABELS: Record<UiMode, string> = {
	baby: '乳幼児（0〜2歳）',
	preschool: '幼児（3〜5歳）',
	elementary: '小学生（6〜12歳）',
	junior: '中学生（13〜15歳）',
	senior: '高校生（16〜18歳）',
};

/** 年齢区分ラベルを安全に取得 */
export function getAgeTierLabel(mode: string): string {
	return AGE_TIER_LABELS[mode as UiMode] ?? mode;
}

// ============================================================
// プラン名
// ============================================================

export const PLAN_LABELS = {
	free: '無料プラン',
	standard: 'スタンダードプラン',
	family: 'ファミリープラン',
} as const;

export const PLAN_SHORT_LABELS = {
	free: '無料',
	standard: 'スタンダード',
	family: 'ファミリー',
} as const;

export type PlanKey = keyof typeof PLAN_LABELS;

// ============================================================
// テーマカラー
// ============================================================

export const THEME_LABELS = {
	pink: 'ピンク',
	blue: 'ブルー',
	green: 'グリーン',
	orange: 'オレンジ',
	purple: 'パープル',
} as const;

export const THEME_EMOJIS = {
	pink: '🩷',
	blue: '💙',
	green: '💚',
	orange: '🧡',
	purple: '💜',
} as const;

export type ThemeKey = keyof typeof THEME_LABELS;

/** テーマ名ラベルを安全に取得 */
export function getThemeLabel(theme: string): string {
	return THEME_LABELS[theme as ThemeKey] ?? theme;
}

// ============================================================
// 機能名
// ============================================================

export const FEATURE_LABELS = {
	report: 'レポート',
	growthBook: 'グロースブック',
	message: 'おうえんメッセージ',
	reward: 'ごほうび',
	checklist: 'チェックリスト',
	activity: '活動',
	points: 'ポイント',
	loginBonus: 'ログインボーナス',
	challenge: 'チャレンジ',
	event: 'イベント',
	certificate: 'がんばり証明書',
	stamp: 'スタンプ',
} as const;

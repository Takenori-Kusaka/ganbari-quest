import { z } from 'zod';
import { AGE_TIER_LABELS } from '../labels';
import type { UiMode } from './age-tier-types';
import { LEGACY_UI_MODE_MAP, UI_MODES } from './age-tier-types';

export type { UiMode } from './age-tier-types';
// 型・定数・正規化関数は age-tier-types.ts に集約（#980: 循環依存解消）
// 既存の import path を維持するため re-export する
// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { LEGACY_UI_MODE_MAP, normalizeUiMode, UI_MODES } from './age-tier-types';

// Zod スキーマ
export const uiModeSchema = z.enum(UI_MODES);

// 年齢帯設定
export const AGE_TIER_CONFIG: Record<
	UiMode,
	{
		label: string;
		ageMin: number;
		ageMax: number;
		tapSize: number;
		fontScale: number;
	}
> = {
	baby: { label: AGE_TIER_LABELS.baby, ageMin: 0, ageMax: 2, tapSize: 120, fontScale: 1.5 },
	preschool: {
		label: AGE_TIER_LABELS.preschool,
		ageMin: 3,
		ageMax: 5,
		tapSize: 80,
		fontScale: 1.2,
	},
	elementary: {
		label: AGE_TIER_LABELS.elementary,
		ageMin: 6,
		ageMax: 12,
		tapSize: 56,
		fontScale: 1.0,
	},
	junior: {
		label: AGE_TIER_LABELS.junior,
		ageMin: 13,
		ageMax: 15,
		tapSize: 48,
		fontScale: 1.0,
	},
	senior: {
		label: AGE_TIER_LABELS.senior,
		ageMin: 16,
		ageMax: 18,
		tapSize: 44,
		fontScale: 1.0,
	},
};

/** 年齢から推定されるデフォルトUIモードを返す */
export function getDefaultUiMode(age: number): UiMode {
	if (age <= 2) return 'baby';
	if (age <= 5) return 'preschool';
	if (age <= 12) return 'elementary';
	if (age <= 15) return 'junior';
	return 'senior';
}

/** 値が有効なUIモードか判定する（旧コード含む） */
export function isValidUiMode(value: string): value is UiMode {
	return UI_MODES.includes(value as UiMode) || value in LEGACY_UI_MODE_MAP;
}

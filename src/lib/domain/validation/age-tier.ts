import { z } from 'zod';

// 年齢帯モード定義
export const UI_MODES = ['baby', 'kinder', 'lower', 'upper', 'teen'] as const;
export type UiMode = (typeof UI_MODES)[number];

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
	baby: { label: 'ベビー', ageMin: 0, ageMax: 2, tapSize: 120, fontScale: 1.5 },
	kinder: { label: 'キンダー', ageMin: 3, ageMax: 5, tapSize: 80, fontScale: 1.2 },
	lower: { label: 'ローワー', ageMin: 6, ageMax: 9, tapSize: 56, fontScale: 1.0 },
	upper: { label: 'アッパー', ageMin: 10, ageMax: 14, tapSize: 48, fontScale: 1.0 },
	teen: { label: 'ティーン', ageMin: 15, ageMax: 18, tapSize: 44, fontScale: 1.0 },
};

/** 年齢から推定されるデフォルトUIモードを返す */
export function getDefaultUiMode(age: number): UiMode {
	if (age <= 2) return 'baby';
	if (age <= 5) return 'kinder';
	if (age <= 9) return 'lower';
	if (age <= 14) return 'upper';
	return 'teen';
}

/** 値が有効なUIモードか判定する */
export function isValidUiMode(value: string): value is UiMode {
	return UI_MODES.includes(value as UiMode);
}

// src/lib/domain/validation/age-tier-types.ts
// 型定義専用モジュール — labels.ts / age-tier.ts の循環依存を解消するために新設 (#980)
// UiMode 型・UI_MODES 定数・LEGACY_UI_MODE_MAP・normalizeUiMode をここに集約し、
// labels.ts と age-tier.ts は共にこのモジュールに依存する形にする。

/** 有効な UI モード一覧（#537: 日本の学校制度に合わせたコード名） */
export const UI_MODES = ['baby', 'preschool', 'elementary', 'junior', 'senior'] as const;

/** UI モードの型 */
export type UiMode = (typeof UI_MODES)[number];

/** 旧コード -> 新コード マッピング（遅延マイグレーション・互換チェック用） */
export const LEGACY_UI_MODE_MAP: Record<string, UiMode> = {
	kinder: 'preschool',
	lower: 'elementary',
	upper: 'junior',
	teen: 'senior',
};

/** 旧コードを含む値を新コードに変換する */
export function normalizeUiMode(value: string): UiMode {
	if (UI_MODES.includes(value as UiMode)) return value as UiMode;
	return LEGACY_UI_MODE_MAP[value] ?? 'preschool';
}

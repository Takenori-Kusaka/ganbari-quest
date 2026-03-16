// src/lib/domain/validation/avatar.ts
// きせかえアバター ドメイン定義

export const AVATAR_CATEGORIES = ['background', 'frame', 'effect'] as const;
export type AvatarCategory = (typeof AVATAR_CATEGORIES)[number];

export const AVATAR_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type AvatarRarity = (typeof AVATAR_RARITIES)[number];

export const RARITY_COLORS: Record<AvatarRarity, string> = {
	common: '#9e9e9e',
	rare: '#2196f3',
	epic: '#9c27b0',
	legendary: '#ff9800',
};

export const RARITY_LABELS: Record<AvatarRarity, string> = {
	common: 'ふつう',
	rare: 'レア',
	epic: 'スーパーレア',
	legendary: 'でんせつ',
};

export const CATEGORY_LABELS: Record<AvatarCategory, string> = {
	background: 'はいけい',
	frame: 'わく',
	effect: 'エフェクト',
};

export const CATEGORY_ICONS: Record<AvatarCategory, string> = {
	background: '🎨',
	frame: '🖼️',
	effect: '✨',
};

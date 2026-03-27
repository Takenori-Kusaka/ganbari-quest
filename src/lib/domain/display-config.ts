// 活動表示スタイル設定
// see: docs/research/activity-display-ux-research.md

export const CARD_SIZES = ['small', 'medium', 'large'] as const;
export type CardSize = (typeof CARD_SIZES)[number];

export interface DisplayConfig {
	/** カードサイズプリセット */
	cardSize: CardSize;
	/** カテゴリごとの表示件数（0 = 無制限） */
	itemsPerCategory: number;
	/** 超過分を折りたたむか */
	collapsible: boolean;
}

export const CARD_SIZE_LABELS: Record<CardSize, string> = {
	small: 'コンパクト',
	medium: 'スタンダード',
	large: 'おおきめ',
};

export const CARD_SIZE_CSS: Record<
	CardSize,
	{ minWidth: string; iconSize: string; textSize: string }
> = {
	small: { minWidth: '70px', iconSize: '2.5rem', textSize: '10px' },
	medium: { minWidth: '90px', iconSize: '3rem', textSize: '11px' },
	large: { minWidth: '120px', iconSize: '4rem', textSize: '13px' },
};

/** 年齢別デフォルト設定 */
export function getDefaultDisplayConfig(age: number): DisplayConfig {
	if (age <= 2) {
		return { cardSize: 'large', itemsPerCategory: 6, collapsible: true };
	}
	if (age <= 5) {
		return { cardSize: 'medium', itemsPerCategory: 0, collapsible: false };
	}
	return { cardSize: 'small', itemsPerCategory: 8, collapsible: true };
}

/** JSON文字列からDisplayConfigをパース（不正値はデフォルトにフォールバック） */
export function parseDisplayConfig(json: string | null | undefined, age: number): DisplayConfig {
	const defaults = getDefaultDisplayConfig(age);
	if (!json) return defaults;
	try {
		const parsed = JSON.parse(json);
		return {
			cardSize: CARD_SIZES.includes(parsed.cardSize) ? parsed.cardSize : defaults.cardSize,
			itemsPerCategory:
				typeof parsed.itemsPerCategory === 'number' && parsed.itemsPerCategory >= 0
					? parsed.itemsPerCategory
					: defaults.itemsPerCategory,
			collapsible:
				typeof parsed.collapsible === 'boolean' ? parsed.collapsible : defaults.collapsible,
		};
	} catch {
		return defaults;
	}
}

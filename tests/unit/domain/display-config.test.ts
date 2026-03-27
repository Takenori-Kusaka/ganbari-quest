import {
	CARD_SIZES,
	CARD_SIZE_CSS,
	CARD_SIZE_LABELS,
	getDefaultDisplayConfig,
	parseDisplayConfig,
} from '$lib/domain/display-config';
import { describe, expect, test } from 'vitest';

describe('DisplayConfig', () => {
	describe('getDefaultDisplayConfig', () => {
		test('Baby (0-2歳) は large カード + 6件 + 折りたたみ', () => {
			const config = getDefaultDisplayConfig(1);
			expect(config).toEqual({ cardSize: 'large', itemsPerCategory: 6, collapsible: true });
		});

		test('Kinder (3-5歳) は medium カード + 無制限 + 折りたたみなし', () => {
			const config = getDefaultDisplayConfig(4);
			expect(config).toEqual({ cardSize: 'medium', itemsPerCategory: 0, collapsible: false });
		});

		test('Elementary (6歳以上) は small カード + 8件 + 折りたたみ', () => {
			const config = getDefaultDisplayConfig(7);
			expect(config).toEqual({ cardSize: 'small', itemsPerCategory: 8, collapsible: true });
		});

		test('0歳は Baby デフォルト', () => {
			expect(getDefaultDisplayConfig(0).cardSize).toBe('large');
		});

		test('2歳は Baby デフォルト', () => {
			expect(getDefaultDisplayConfig(2).cardSize).toBe('large');
		});

		test('3歳は Kinder デフォルト', () => {
			expect(getDefaultDisplayConfig(3).cardSize).toBe('medium');
		});

		test('5歳は Kinder デフォルト', () => {
			expect(getDefaultDisplayConfig(5).cardSize).toBe('medium');
		});

		test('6歳は Elementary デフォルト', () => {
			expect(getDefaultDisplayConfig(6).cardSize).toBe('small');
		});
	});

	describe('parseDisplayConfig', () => {
		test('null はデフォルトにフォールバック', () => {
			const config = parseDisplayConfig(null, 4);
			expect(config.cardSize).toBe('medium');
		});

		test('undefined はデフォルトにフォールバック', () => {
			const config = parseDisplayConfig(undefined, 1);
			expect(config.cardSize).toBe('large');
		});

		test('空文字はデフォルトにフォールバック', () => {
			const config = parseDisplayConfig('', 7);
			expect(config.cardSize).toBe('small');
		});

		test('不正なJSONはデフォルトにフォールバック', () => {
			const config = parseDisplayConfig('{invalid json', 4);
			expect(config.cardSize).toBe('medium');
		});

		test('正常なJSONをパース', () => {
			const json = JSON.stringify({
				cardSize: 'small',
				itemsPerCategory: 10,
				collapsible: true,
			});
			const config = parseDisplayConfig(json, 4);
			expect(config).toEqual({ cardSize: 'small', itemsPerCategory: 10, collapsible: true });
		});

		test('不正な cardSize はデフォルトにフォールバック', () => {
			const json = JSON.stringify({ cardSize: 'invalid', itemsPerCategory: 5, collapsible: false });
			const config = parseDisplayConfig(json, 4);
			expect(config.cardSize).toBe('medium'); // Kinder default
		});

		test('不正な itemsPerCategory はデフォルトにフォールバック', () => {
			const json = JSON.stringify({ cardSize: 'small', itemsPerCategory: -1, collapsible: false });
			const config = parseDisplayConfig(json, 7);
			expect(config.itemsPerCategory).toBe(8); // Elementary default
		});

		test('不正な collapsible はデフォルトにフォールバック', () => {
			const json = JSON.stringify({ cardSize: 'small', itemsPerCategory: 5, collapsible: 'yes' });
			const config = parseDisplayConfig(json, 7);
			expect(config.collapsible).toBe(true); // Elementary default
		});

		test('部分的な設定は欠損部分だけデフォルト', () => {
			const json = JSON.stringify({ cardSize: 'large' });
			const config = parseDisplayConfig(json, 4);
			expect(config.cardSize).toBe('large');
			expect(config.itemsPerCategory).toBe(0); // Kinder default
			expect(config.collapsible).toBe(false); // Kinder default
		});
	});

	describe('定数', () => {
		test('CARD_SIZES は 3 プリセット', () => {
			expect(CARD_SIZES).toEqual(['small', 'medium', 'large']);
		});

		test('CARD_SIZE_LABELS はすべてのサイズに対応', () => {
			for (const size of CARD_SIZES) {
				expect(CARD_SIZE_LABELS[size]).toBeDefined();
			}
		});

		test('CARD_SIZE_CSS はすべてのサイズに minWidth/iconSize/textSize を持つ', () => {
			for (const size of CARD_SIZES) {
				expect(CARD_SIZE_CSS[size]).toHaveProperty('minWidth');
				expect(CARD_SIZE_CSS[size]).toHaveProperty('iconSize');
				expect(CARD_SIZE_CSS[size]).toHaveProperty('textSize');
			}
		});
	});
});

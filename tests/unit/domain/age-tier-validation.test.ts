import { describe, expect, it } from 'vitest';
import {
	AGE_TIER_CONFIG,
	UI_MODES,
	getDefaultUiMode,
	isValidUiMode,
	uiModeSchema,
} from '../../../src/lib/domain/validation/age-tier';

describe('age-tier validation', () => {
	describe('UI_MODES', () => {
		it('5つの年齢帯モードが定義されている', () => {
			expect(UI_MODES).toEqual(['baby', 'kinder', 'lower', 'upper', 'teen']);
			expect(UI_MODES).toHaveLength(5);
		});
	});

	describe('uiModeSchema', () => {
		it.each(['baby', 'kinder', 'lower', 'upper', 'teen'])('%s は有効なUIモード', (mode) => {
			expect(uiModeSchema.safeParse(mode).success).toBe(true);
		});

		it.each(['invalid', '', 'KINDER', 'Baby', 'child'])('%s は無効なUIモード', (mode) => {
			expect(uiModeSchema.safeParse(mode).success).toBe(false);
		});
	});

	describe('AGE_TIER_CONFIG', () => {
		it('全モードの設定が存在する', () => {
			for (const mode of UI_MODES) {
				const config = AGE_TIER_CONFIG[mode];
				expect(config).toBeDefined();
				expect(config.label).toBeTruthy();
				expect(config.ageMin).toBeGreaterThanOrEqual(0);
				expect(config.ageMax).toBeGreaterThan(config.ageMin);
				expect(config.tapSize).toBeGreaterThan(0);
				expect(config.fontScale).toBeGreaterThan(0);
			}
		});

		it('baby のタップサイズが最大', () => {
			expect(AGE_TIER_CONFIG.baby.tapSize).toBe(120);
		});

		it('kinder のタップサイズは80px', () => {
			expect(AGE_TIER_CONFIG.kinder.tapSize).toBe(80);
		});

		it('年齢帯は重複なく連続している', () => {
			const modes = UI_MODES.map((m) => AGE_TIER_CONFIG[m]);
			for (let i = 1; i < modes.length; i++) {
				expect(modes[i]?.ageMin).toBe(modes[i - 1]?.ageMax + 1);
			}
		});
	});

	describe('getDefaultUiMode', () => {
		it.each([
			[0, 'baby'],
			[1, 'baby'],
			[2, 'baby'],
			[3, 'kinder'],
			[4, 'kinder'],
			[5, 'kinder'],
			[6, 'lower'],
			[9, 'lower'],
			[10, 'upper'],
			[14, 'upper'],
			[15, 'teen'],
			[18, 'teen'],
		])('年齢 %d → %s', (age, expected) => {
			expect(getDefaultUiMode(age)).toBe(expected);
		});

		it('18歳超もteenになる', () => {
			expect(getDefaultUiMode(20)).toBe('teen');
		});
	});

	describe('isValidUiMode', () => {
		it.each(['baby', 'kinder', 'lower', 'upper', 'teen'])('%s は有効', (mode) => {
			expect(isValidUiMode(mode)).toBe(true);
		});

		it.each(['invalid', '', 'KINDER', 'child', 'adult'])('%s は無効', (mode) => {
			expect(isValidUiMode(mode)).toBe(false);
		});
	});
});

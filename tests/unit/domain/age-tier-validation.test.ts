import { describe, expect, it } from 'vitest';
import {
	AGE_TIER_CONFIG,
	getDefaultUiMode,
	isValidUiMode,
	UI_MODES,
	uiModeSchema,
} from '../../../src/lib/domain/validation/age-tier';

describe('age-tier validation', () => {
	describe('UI_MODES', () => {
		it('5つの年齢帯モードが定義されている', () => {
			expect(UI_MODES).toEqual(['baby', 'preschool', 'elementary', 'junior', 'senior']);
			expect(UI_MODES).toHaveLength(5);
		});
	});

	describe('uiModeSchema', () => {
		it.each([
			'baby',
			'preschool',
			'elementary',
			'junior',
			'senior',
		])('%s は有効なUIモード', (mode) => {
			expect(uiModeSchema.safeParse(mode).success).toBe(true);
		});

		it.each(['invalid', '', 'PRESCHOOL', 'Baby', 'child'])('%s は無効なUIモード', (mode) => {
			expect(uiModeSchema.safeParse(mode).success).toBe(false);
		});
	});

	describe('AGE_TIER_CONFIG', () => {
		it('全モードの設定が存在する', () => {
			for (const mode of UI_MODES) {
				const config = AGE_TIER_CONFIG[mode];
				expect(config).toBeDefined();
				expect(config.label).toBeTypeOf('string');
				expect(config.ageMin).toBeGreaterThanOrEqual(0);
				expect(config.ageMax).toBeGreaterThan(config.ageMin);
				expect(config.tapSize).toBeGreaterThan(0);
				expect(config.fontScale).toBeGreaterThan(0);
			}
		});

		it('baby のタップサイズが最大', () => {
			expect(AGE_TIER_CONFIG.baby.tapSize).toBe(120);
		});

		it('preschool のタップサイズは80px', () => {
			expect(AGE_TIER_CONFIG.preschool.tapSize).toBe(80);
		});

		it('年齢帯は重複なく連続している', () => {
			const modes = UI_MODES.map((m) => AGE_TIER_CONFIG[m]);
			for (let i = 1; i < modes.length; i++) {
				expect(modes[i]?.ageMin).toBe((modes[i - 1]?.ageMax ?? 0) + 1);
			}
		});
	});

	describe('getDefaultUiMode', () => {
		it.each([
			[0, 'baby'],
			[1, 'baby'],
			[2, 'baby'],
			[3, 'preschool'],
			[4, 'preschool'],
			[5, 'preschool'],
			[6, 'elementary'],
			[10, 'elementary'],
			[12, 'elementary'],
			[13, 'junior'],
			[15, 'junior'],
			[16, 'senior'],
			[18, 'senior'],
		])('年齢 %d → %s', (age, expected) => {
			expect(getDefaultUiMode(age)).toBe(expected);
		});

		it('18歳超もseniorになる', () => {
			expect(getDefaultUiMode(20)).toBe('senior');
		});
	});

	describe('isValidUiMode', () => {
		it.each(['baby', 'preschool', 'elementary', 'junior', 'senior'])('%s は有効', (mode) => {
			expect(isValidUiMode(mode)).toBe(true);
		});

		it.each(['invalid', '', 'PRESCHOOL', 'child', 'adult'])('%s は無効', (mode) => {
			expect(isValidUiMode(mode)).toBe(false);
		});
	});
});

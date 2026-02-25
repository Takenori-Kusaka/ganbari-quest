// tests/unit/domain/achievement-validation.test.ts
// 実績ドメインバリデーションのユニットテスト

import { describe, expect, it } from 'vitest';
import {
	CONDITION_TYPES,
	RARITIES,
	achievementQuerySchema,
	conditionTypeSchema,
	raritySchema,
} from '../../../src/lib/domain/validation/achievement';

describe('CONDITION_TYPES', () => {
	it('6種類の条件タイプが定義されている', () => {
		expect(CONDITION_TYPES).toHaveLength(6);
	});

	it.each([
		'streak_days',
		'total_activities',
		'category_complete',
		'all_categories',
		'level_reach',
		'total_points',
	])('%s が含まれる', (type) => {
		expect(CONDITION_TYPES).toContain(type);
	});
});

describe('RARITIES', () => {
	it('4種類のレアリティが定義されている', () => {
		expect(RARITIES).toHaveLength(4);
	});

	it.each(['common', 'rare', 'epic', 'legendary'])('%s が含まれる', (rarity) => {
		expect(RARITIES).toContain(rarity);
	});
});

describe('conditionTypeSchema', () => {
	it.each(CONDITION_TYPES)('有効な条件タイプ: %s', (type) => {
		expect(conditionTypeSchema.safeParse(type).success).toBe(true);
	});

	it('無効な条件タイプを拒否する', () => {
		expect(conditionTypeSchema.safeParse('invalid').success).toBe(false);
		expect(conditionTypeSchema.safeParse('').success).toBe(false);
		expect(conditionTypeSchema.safeParse(123).success).toBe(false);
	});
});

describe('raritySchema', () => {
	it.each(RARITIES)('有効なレアリティ: %s', (rarity) => {
		expect(raritySchema.safeParse(rarity).success).toBe(true);
	});

	it('無効なレアリティを拒否する', () => {
		expect(raritySchema.safeParse('ultra').success).toBe(false);
		expect(raritySchema.safeParse('').success).toBe(false);
	});
});

describe('achievementQuerySchema', () => {
	it('正の整数 childId を受け入れる', () => {
		const result = achievementQuerySchema.safeParse({ childId: 1 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.childId).toBe(1);
		}
	});

	it('文字列の数値を数値に変換する', () => {
		const result = achievementQuerySchema.safeParse({ childId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.childId).toBe(5);
		}
	});

	it('0 を拒否する', () => {
		expect(achievementQuerySchema.safeParse({ childId: 0 }).success).toBe(false);
	});

	it('負の数を拒否する', () => {
		expect(achievementQuerySchema.safeParse({ childId: -1 }).success).toBe(false);
	});

	it('小数を拒否する', () => {
		expect(achievementQuerySchema.safeParse({ childId: 1.5 }).success).toBe(false);
	});

	it('childId 未指定を拒否する', () => {
		expect(achievementQuerySchema.safeParse({}).success).toBe(false);
	});

	it('文字列を拒否する', () => {
		expect(achievementQuerySchema.safeParse({ childId: 'abc' }).success).toBe(false);
	});
});

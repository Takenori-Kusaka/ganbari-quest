// tests/unit/domain/special-reward-validation.test.ts
// 特別報酬ドメインバリデーションのユニットテスト

import { describe, expect, it } from 'vitest';
import {
	REWARD_CATEGORIES,
	grantSpecialRewardSchema,
	rewardCategorySchema,
	rewardTemplateSchema,
	rewardTemplatesArraySchema,
	specialRewardQuerySchema,
} from '../../../src/lib/domain/validation/special-reward';

describe('REWARD_CATEGORIES', () => {
	it('6種類のカテゴリが定義されている', () => {
		expect(REWARD_CATEGORIES).toHaveLength(6);
	});

	it.each(['academic', 'sports', 'social', 'creative', 'life', 'other'])('%s が含まれる', (cat) => {
		expect(REWARD_CATEGORIES).toContain(cat);
	});
});

describe('rewardCategorySchema', () => {
	it.each(REWARD_CATEGORIES)('有効なカテゴリ: %s', (cat) => {
		expect(rewardCategorySchema.safeParse(cat).success).toBe(true);
	});

	it('無効なカテゴリを拒否する', () => {
		expect(rewardCategorySchema.safeParse('invalid').success).toBe(false);
		expect(rewardCategorySchema.safeParse('').success).toBe(false);
	});
});

describe('grantSpecialRewardSchema', () => {
	const validData = {
		childId: 1,
		title: 'テスト100点',
		points: 100,
		category: 'academic',
	};

	it('正常なデータを受け入れる', () => {
		const result = grantSpecialRewardSchema.safeParse(validData);
		expect(result.success).toBe(true);
	});

	it('オプショナルフィールド付きのデータを受け入れる', () => {
		const result = grantSpecialRewardSchema.safeParse({
			...validData,
			description: '中間テストで満点をとった',
			icon: '🎓',
		});
		expect(result.success).toBe(true);
	});

	it('childId が文字列でも数値に変換する', () => {
		const result = grantSpecialRewardSchema.safeParse({
			...validData,
			childId: '3',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.childId).toBe(3);
		}
	});

	it('title が空文字を拒否する', () => {
		expect(grantSpecialRewardSchema.safeParse({ ...validData, title: '' }).success).toBe(false);
	});

	it('title が101文字以上を拒否する', () => {
		expect(
			grantSpecialRewardSchema.safeParse({ ...validData, title: 'あ'.repeat(101) }).success,
		).toBe(false);
	});

	it('points が0以下を拒否する', () => {
		expect(grantSpecialRewardSchema.safeParse({ ...validData, points: 0 }).success).toBe(false);
		expect(grantSpecialRewardSchema.safeParse({ ...validData, points: -10 }).success).toBe(false);
	});

	it('points が10000超を拒否する', () => {
		expect(grantSpecialRewardSchema.safeParse({ ...validData, points: 10001 }).success).toBe(false);
	});

	it('points が小数を拒否する', () => {
		expect(grantSpecialRewardSchema.safeParse({ ...validData, points: 1.5 }).success).toBe(false);
	});

	it('無効なカテゴリを拒否する', () => {
		expect(grantSpecialRewardSchema.safeParse({ ...validData, category: 'invalid' }).success).toBe(
			false,
		);
	});

	it('childId 未指定を拒否する', () => {
		const { childId, ...rest } = validData;
		expect(grantSpecialRewardSchema.safeParse(rest).success).toBe(false);
	});
});

describe('specialRewardQuerySchema', () => {
	it('正の整数を受け入れる', () => {
		expect(specialRewardQuerySchema.safeParse({ childId: 1 }).success).toBe(true);
	});

	it('文字列を数値に変換する', () => {
		const result = specialRewardQuerySchema.safeParse({ childId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.childId).toBe(5);
		}
	});

	it('0を拒否する', () => {
		expect(specialRewardQuerySchema.safeParse({ childId: 0 }).success).toBe(false);
	});
});

describe('rewardTemplateSchema', () => {
	it('正常なテンプレートを受け入れる', () => {
		const result = rewardTemplateSchema.safeParse({
			title: 'テスト100点',
			points: 100,
			icon: '🎓',
			category: 'academic',
		});
		expect(result.success).toBe(true);
	});

	it('icon なしでも受け入れる', () => {
		const result = rewardTemplateSchema.safeParse({
			title: 'がんばったで賞',
			points: 50,
			category: 'other',
		});
		expect(result.success).toBe(true);
	});
});

describe('rewardTemplatesArraySchema', () => {
	it('テンプレート配列を受け入れる', () => {
		const result = rewardTemplatesArraySchema.safeParse([
			{ title: 'テスト100点', points: 100, icon: '🎓', category: 'academic' },
			{ title: '大会入賞', points: 150, icon: '🏆', category: 'sports' },
		]);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toHaveLength(2);
		}
	});

	it('空配列を受け入れる', () => {
		const result = rewardTemplatesArraySchema.safeParse([]);
		expect(result.success).toBe(true);
	});

	it('不正なアイテムを含む配列を拒否する', () => {
		const result = rewardTemplatesArraySchema.safeParse([
			{ title: '', points: 0, category: 'invalid' },
		]);
		expect(result.success).toBe(false);
	});
});

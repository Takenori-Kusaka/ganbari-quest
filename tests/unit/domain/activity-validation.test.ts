// tests/unit/domain/activity-validation.test.ts
// 活動バリデーションスキーマのユニットテスト

import { describe, it, expect } from 'vitest';
import {
	createActivitySchema,
	updateActivitySchema,
	recordActivitySchema,
	activitiesQuerySchema,
	activityLogsQuerySchema,
	calcStreakBonus,
	todayDate,
	CANCEL_WINDOW_MS,
} from '../../../src/lib/domain/validation/activity';

describe('createActivitySchema', () => {
	it('有効な入力を受け入れる', () => {
		const result = createActivitySchema.safeParse({
			name: 'たいそうした',
			category: 'うんどう',
			icon: '🤸',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(true);
	});

	it('name が空文字だとエラー', () => {
		const result = createActivitySchema.safeParse({
			name: '',
			category: 'うんどう',
			icon: '🤸',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('name が50文字を超えるとエラー', () => {
		const result = createActivitySchema.safeParse({
			name: 'あ'.repeat(51),
			category: 'うんどう',
			icon: '🤸',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('不正なカテゴリはエラー', () => {
		const result = createActivitySchema.safeParse({
			name: 'テスト',
			category: 'まほう',
			icon: '✨',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('basePoints が0以下だとエラー', () => {
		const result = createActivitySchema.safeParse({
			name: 'テスト',
			category: 'うんどう',
			icon: '🤸',
			basePoints: 0,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('basePoints が100を超えるとエラー', () => {
		const result = createActivitySchema.safeParse({
			name: 'テスト',
			category: 'うんどう',
			icon: '🤸',
			basePoints: 101,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});
});

describe('updateActivitySchema', () => {
	it('部分的な更新を受け入れる', () => {
		const result = updateActivitySchema.safeParse({ name: '新しい名前' });
		expect(result.success).toBe(true);
	});

	it('空オブジェクトを受け入れる', () => {
		const result = updateActivitySchema.safeParse({});
		expect(result.success).toBe(true);
	});
});

describe('recordActivitySchema', () => {
	it('有効な入力を受け入れる', () => {
		const result = recordActivitySchema.safeParse({
			childId: 1,
			activityId: 3,
		});
		expect(result.success).toBe(true);
	});

	it('childId が0以下だとエラー', () => {
		const result = recordActivitySchema.safeParse({
			childId: 0,
			activityId: 3,
		});
		expect(result.success).toBe(false);
	});

	it('activityId が負数だとエラー', () => {
		const result = recordActivitySchema.safeParse({
			childId: 1,
			activityId: -1,
		});
		expect(result.success).toBe(false);
	});
});

describe('activitiesQuerySchema', () => {
	it('パラメータなしを受け入れる', () => {
		const result = activitiesQuerySchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('childId を数値に変換する', () => {
		const result = activitiesQuerySchema.safeParse({ childId: '1' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.childId).toBe(1);
		}
	});

	it('category フィルタを受け入れる', () => {
		const result = activitiesQuerySchema.safeParse({ category: 'うんどう' });
		expect(result.success).toBe(true);
	});

	it('includeHidden を変換する', () => {
		const result = activitiesQuerySchema.safeParse({ includeHidden: 'true' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.includeHidden).toBe(true);
		}
	});
});

describe('activityLogsQuerySchema', () => {
	it('childId 必須を検証する', () => {
		const result = activityLogsQuerySchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it('有効なクエリを受け入れる', () => {
		const result = activityLogsQuerySchema.safeParse({ childId: '1' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.childId).toBe(1);
			expect(result.data.period).toBe('week');
		}
	});

	it('period を受け入れる', () => {
		const result = activityLogsQuerySchema.safeParse({
			childId: '1',
			period: 'month',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.period).toBe('month');
		}
	});

	it('不正な period はエラー', () => {
		const result = activityLogsQuerySchema.safeParse({
			childId: '1',
			period: 'decade',
		});
		expect(result.success).toBe(false);
	});
});

describe('calcStreakBonus', () => {
	it('1日目はボーナスなし', () => {
		expect(calcStreakBonus(1)).toBe(0);
	});

	it('2日連続で +1', () => {
		expect(calcStreakBonus(2)).toBe(1);
	});

	it('5日連続で +4', () => {
		expect(calcStreakBonus(5)).toBe(4);
	});

	it('11日連続で上限 +10', () => {
		expect(calcStreakBonus(11)).toBe(10);
	});

	it('20日連続でも上限 +10', () => {
		expect(calcStreakBonus(20)).toBe(10);
	});

	it('0日以下はボーナスなし', () => {
		expect(calcStreakBonus(0)).toBe(0);
	});
});

describe('todayDate', () => {
	it('YYYY-MM-DD 形式を返す', () => {
		const d = todayDate();
		expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('CANCEL_WINDOW_MS', () => {
	it('5秒（5000ms）である', () => {
		expect(CANCEL_WINDOW_MS).toBe(5000);
	});
});

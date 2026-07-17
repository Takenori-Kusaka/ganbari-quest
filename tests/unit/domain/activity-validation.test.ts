import * as v from 'valibot';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
// tests/unit/domain/activity-validation.test.ts
// 活動バリデーションスキーマのユニットテスト

import { describe, expect, it } from 'vitest';
import {
	activitiesQuerySchema,
	activityLogsQuerySchema,
	CANCEL_WINDOW_MS,
	calcStreakBonus,
	createActivitySchema,
	recordActivitySchema,
	sanitizeActivityNameField,
	sanitizeDailyLimit,
	todayDate,
	updateActivitySchema,
} from '../../../src/lib/domain/validation/activity';

describe('#3463 sanitizeDailyLimit (import 境界 + server clamp)', () => {
	it('null / 空文字 / undefined は null', () => {
		expect(sanitizeDailyLimit(null)).toBeNull();
		expect(sanitizeDailyLimit('')).toBeNull();
		expect(sanitizeDailyLimit(undefined)).toBeNull();
	});
	it('範囲内の整数はそのまま', () => {
		expect(sanitizeDailyLimit(3)).toBe(3);
		expect(sanitizeDailyLimit('5')).toBe(5);
	});
	it('dailyLimit=0 (無制限) は保全する (#3422 整合)', () => {
		expect(sanitizeDailyLimit(0)).toBe(0);
		expect(sanitizeDailyLimit('0')).toBe(0);
	});
	it('負値 (下限外の不正入力) は安全既定 null (=1回) に倒す — 0=無制限への昇格を避ける (#3463 item2 default-allow 防止)', () => {
		expect(sanitizeDailyLimit(-5)).toBeNull();
		expect(sanitizeDailyLimit('-1')).toBeNull();
		expect(sanitizeDailyLimit(-0.5)).toBeNull();
	});
	it('上限超は 99 へ clamp', () => {
		expect(sanitizeDailyLimit(1000)).toBe(99);
	});
	it('非整数は切り捨て', () => {
		expect(sanitizeDailyLimit(3.9)).toBe(3);
	});
	it('NaN / 非数値文字列は null (default-deny)', () => {
		expect(sanitizeDailyLimit('abc')).toBeNull();
		expect(sanitizeDailyLimit(Number.NaN)).toBeNull();
		expect(sanitizeDailyLimit(Number.POSITIVE_INFINITY)).toBeNull();
	});
});

describe('#3463 sanitizeActivityNameField (読み仮名/漢字 max 50)', () => {
	it('null は null', () => {
		expect(sanitizeActivityNameField(null)).toBeNull();
	});
	it('50 文字以内はそのまま', () => {
		expect(sanitizeActivityNameField('おてつだい')).toBe('おてつだい');
	});
	it('50 文字超は切詰め', () => {
		const long = 'あ'.repeat(120);
		expect(sanitizeActivityNameField(long)).toHaveLength(50);
	});
});

describe('createActivitySchema', () => {
	it('有効な入力を受け入れる', () => {
		const result = v.safeParse(createActivitySchema, {
			name: 'たいそうした',
			categoryId: asCategoryId(1),
			icon: '🤸',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(true);
	});

	it('name が空文字だとエラー', () => {
		const result = v.safeParse(createActivitySchema, {
			name: '',
			categoryId: asCategoryId(1),
			icon: '🤸',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('name が50文字を超えるとエラー', () => {
		const result = v.safeParse(createActivitySchema, {
			name: 'あ'.repeat(51),
			categoryId: asCategoryId(1),
			icon: '🤸',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('不正なカテゴリはエラー', () => {
		const result = v.safeParse(createActivitySchema, {
			name: 'テスト',
			categoryId: asCategoryId(99),
			icon: '✨',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('basePoints が0以下だとエラー', () => {
		const result = v.safeParse(createActivitySchema, {
			name: 'テスト',
			categoryId: asCategoryId(1),
			icon: '🤸',
			basePoints: 0,
			ageMin: null,
			ageMax: null,
		});
		expect(result.success).toBe(false);
	});

	it('basePoints が100を超えるとエラー', () => {
		const result = v.safeParse(createActivitySchema, {
			name: 'テスト',
			categoryId: asCategoryId(1),
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
		const result = v.safeParse(updateActivitySchema, { name: '新しい名前' });
		expect(result.success).toBe(true);
	});

	it('空オブジェクトを受け入れる', () => {
		const result = v.safeParse(updateActivitySchema, {});
		expect(result.success).toBe(true);
	});
});

describe('recordActivitySchema', () => {
	it('有効な入力を受け入れる', () => {
		const result = v.safeParse(recordActivitySchema, {
			childId: asChildId(1),
			activityId: asActivityId(3),
		});
		expect(result.success).toBe(true);
	});

	it('childId が0以下だとエラー', () => {
		// #3575: 旧クライアント互換の number 入力。0 以下は旧 schema (int().positive()) 同等に拒否
		const result = v.safeParse(recordActivitySchema, {
			childId: 0,
			activityId: asActivityId(3),
		});
		expect(result.success).toBe(false);
	});

	it('activityId が負数だとエラー', () => {
		// #3575: 旧クライアント互換の number 入力。負数は旧 schema 同等に拒否
		const result = v.safeParse(recordActivitySchema, {
			childId: asChildId(1),
			activityId: -1,
		});
		expect(result.success).toBe(false);
	});
});

describe('activitiesQuerySchema', () => {
	it('パラメータなしを受け入れる', () => {
		const result = v.safeParse(activitiesQuerySchema, {});
		expect(result.success).toBe(true);
	});

	it('childId を数値に変換する', () => {
		const result = v.safeParse(activitiesQuerySchema, { childId: '1' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.childId).toBe('1');
		}
	});

	it('category フィルタを受け入れる', () => {
		const result = v.safeParse(activitiesQuerySchema, { categoryId: asCategoryId(1) });
		expect(result.success).toBe(true);
	});

	it('includeHidden を変換する', () => {
		const result = v.safeParse(activitiesQuerySchema, { includeHidden: 'true' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.includeHidden).toBe(true);
		}
	});
});

describe('activityLogsQuerySchema', () => {
	it('childId 必須を検証する', () => {
		const result = v.safeParse(activityLogsQuerySchema, {});
		expect(result.success).toBe(false);
	});

	it('有効なクエリを受け入れる', () => {
		const result = v.safeParse(activityLogsQuerySchema, { childId: '1' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.childId).toBe('1');
			expect(result.output.period).toBe('week');
		}
	});

	it('period を受け入れる', () => {
		const result = v.safeParse(activityLogsQuerySchema, {
			childId: '1',
			period: 'month',
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.output.period).toBe('month');
		}
	});

	it('不正な period はエラー', () => {
		const result = v.safeParse(activityLogsQuerySchema, {
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

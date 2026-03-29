// tests/unit/domain/activity-mastery.test.ts
// 活動習熟レベル計算のユニットテスト

import { describe, expect, it } from 'vitest';
import {
	MASTERY_LEVEL_TABLE,
	MASTERY_MILESTONE_LEVELS,
	calcMasteryBonus,
	calcMasteryLevel,
	countToNextMasteryLevel,
} from '../../../src/lib/domain/validation/activity';

describe('calcMasteryLevel', () => {
	it('0回でLv1', () => {
		expect(calcMasteryLevel(0)).toBe(1);
	});

	it('4回でもLv1（5回未満）', () => {
		expect(calcMasteryLevel(4)).toBe(1);
	});

	it('5回でLv2', () => {
		expect(calcMasteryLevel(5)).toBe(2);
	});

	it('10回でLv3', () => {
		expect(calcMasteryLevel(10)).toBe(3);
	});

	it('20回でLv4', () => {
		expect(calcMasteryLevel(20)).toBe(4);
	});

	it('30回でLv5', () => {
		expect(calcMasteryLevel(30)).toBe(5);
	});

	it('49回でもLv5（50回未満）', () => {
		expect(calcMasteryLevel(49)).toBe(5);
	});

	it('50回でLv6', () => {
		expect(calcMasteryLevel(50)).toBe(6);
	});

	it('100回でLv8', () => {
		expect(calcMasteryLevel(100)).toBe(8);
	});

	it('170回でLv10', () => {
		expect(calcMasteryLevel(170)).toBe(10);
	});

	it('9999回でLv99', () => {
		expect(calcMasteryLevel(9999)).toBe(99);
	});

	it('10000回以上でもLv99（上限）', () => {
		expect(calcMasteryLevel(99999)).toBe(99);
	});

	it('負の値でLv1', () => {
		expect(calcMasteryLevel(-1)).toBe(1);
	});
});

describe('countToNextMasteryLevel', () => {
	it('0回 → 次のLv2まで5回', () => {
		expect(countToNextMasteryLevel(0)).toBe(5);
	});

	it('3回 → 次のLv2まで2回', () => {
		expect(countToNextMasteryLevel(3)).toBe(2);
	});

	it('5回（Lv2） → 次のLv3まで5回', () => {
		expect(countToNextMasteryLevel(5)).toBe(5);
	});

	it('29回（Lv4） → 次のLv5まで1回', () => {
		expect(countToNextMasteryLevel(29)).toBe(1);
	});

	it('9999回（Lv99） → 上限なので0', () => {
		expect(countToNextMasteryLevel(9999)).toBe(0);
	});
});

describe('calcMasteryBonus', () => {
	it('Lv1 → +0pt', () => {
		expect(calcMasteryBonus(1)).toBe(0);
	});

	it('Lv4 → +0pt', () => {
		expect(calcMasteryBonus(4)).toBe(0);
	});

	it('Lv5 → +1pt', () => {
		expect(calcMasteryBonus(5)).toBe(1);
	});

	it('Lv9 → +1pt', () => {
		expect(calcMasteryBonus(9)).toBe(1);
	});

	it('Lv10 → +2pt', () => {
		expect(calcMasteryBonus(10)).toBe(2);
	});

	it('Lv99 → +19pt', () => {
		expect(calcMasteryBonus(99)).toBe(19);
	});
});

describe('MASTERY_LEVEL_TABLE', () => {
	it('テーブルが昇順でソートされている', () => {
		for (let i = 1; i < MASTERY_LEVEL_TABLE.length; i++) {
			const current = MASTERY_LEVEL_TABLE[i]!;
			const prev = MASTERY_LEVEL_TABLE[i - 1]!;
			expect(current.minCount).toBeGreaterThan(prev.minCount);
			expect(current.level).toBeGreaterThan(prev.level);
		}
	});

	it('Lv1が0回から始まる', () => {
		expect(MASTERY_LEVEL_TABLE[0]).toEqual({ minCount: 0, level: 1 });
	});

	it('最終エントリがLv99', () => {
		const last = MASTERY_LEVEL_TABLE[MASTERY_LEVEL_TABLE.length - 1]!;
		expect(last.level).toBe(99);
	});
});

describe('MASTERY_MILESTONE_LEVELS', () => {
	it('5, 10, 20, 30, 50, 99が含まれる', () => {
		for (const lv of [5, 10, 20, 30, 50, 99]) {
			expect(MASTERY_MILESTONE_LEVELS.has(lv)).toBe(true);
		}
	});

	it('1, 2, 3は含まれない', () => {
		for (const lv of [1, 2, 3]) {
			expect(MASTERY_MILESTONE_LEVELS.has(lv)).toBe(false);
		}
	});
});

// tests/unit/domain/status-validation.test.ts
// ステータス計算ロジックのユニットテスト

import { describe, it, expect } from 'vitest';
import {
	calcLevel,
	calcExpToNextLevel,
	calcDeviationScore,
	calcStars,
	calcCharacterType,
	calcDecay,
	calcTrend,
	getAgeCoefficient,
	LEVEL_TABLE,
} from '../../../src/lib/domain/validation/status';

describe('calcLevel', () => {
	it('平均0はレベル1', () => {
		expect(calcLevel(0)).toEqual({ level: 1, title: 'はじめのぼうけんしゃ' });
	});

	it('平均25はレベル3', () => {
		expect(calcLevel(25)).toEqual({ level: 3, title: 'わくわくファイター' });
	});

	it('平均50はレベル6', () => {
		expect(calcLevel(50)).toEqual({ level: 6, title: 'すごうでアドベンチャー' });
	});

	it('平均90はレベル10', () => {
		expect(calcLevel(90)).toEqual({ level: 10, title: 'かみさまレベル' });
	});

	it('平均100はレベル10', () => {
		expect(calcLevel(100)).toEqual({ level: 10, title: 'かみさまレベル' });
	});

	it('負の値はレベル1にクランプ', () => {
		expect(calcLevel(-10).level).toBe(1);
	});

	it('100超はレベル10にクランプ', () => {
		expect(calcLevel(150).level).toBe(10);
	});
});

describe('calcExpToNextLevel', () => {
	it('レベル1(avg=5)なら次まで5', () => {
		expect(calcExpToNextLevel(5)).toBe(5);
	});

	it('レベル10なら0', () => {
		expect(calcExpToNextLevel(95)).toBe(0);
	});

	it('ちょうどレベル境界（avg=10, Lv2）なら次まで10', () => {
		// avg=10 → Lv2(10-19), 次のLv3は20 → 20-10=10
		expect(calcExpToNextLevel(10)).toBe(10);
	});
});

describe('calcDeviationScore', () => {
	it('平均値なら偏差値50', () => {
		expect(calcDeviationScore(50, 50, 10)).toBe(50);
	});

	it('平均+1σなら偏差値60', () => {
		expect(calcDeviationScore(60, 50, 10)).toBe(60);
	});

	it('平均-1σなら偏差値40', () => {
		expect(calcDeviationScore(40, 50, 10)).toBe(40);
	});

	it('標準偏差0なら偏差値50（ゼロ除算回避）', () => {
		expect(calcDeviationScore(70, 50, 0)).toBe(50);
	});
});

describe('calcStars', () => {
	it('偏差値65以上で5星', () => {
		expect(calcStars(65)).toBe(5);
		expect(calcStars(70)).toBe(5);
	});

	it('偏差値58-64で4星', () => {
		expect(calcStars(58)).toBe(4);
		expect(calcStars(64)).toBe(4);
	});

	it('偏差値50-57で3星', () => {
		expect(calcStars(50)).toBe(3);
		expect(calcStars(57)).toBe(3);
	});

	it('偏差値42-49で2星', () => {
		expect(calcStars(42)).toBe(2);
		expect(calcStars(49)).toBe(2);
	});

	it('偏差値41以下で1星', () => {
		expect(calcStars(41)).toBe(1);
		expect(calcStars(30)).toBe(1);
	});
});

describe('calcCharacterType', () => {
	it('偏差値55以上でhero', () => {
		expect(calcCharacterType(55)).toBe('hero');
		expect(calcCharacterType(60)).toBe('hero');
	});

	it('偏差値45-54でnormal', () => {
		expect(calcCharacterType(45)).toBe('normal');
		expect(calcCharacterType(54)).toBe('normal');
	});

	it('偏差値44以下でganbari', () => {
		expect(calcCharacterType(44)).toBe('ganbari');
		expect(calcCharacterType(30)).toBe('ganbari');
	});
});

describe('getAgeCoefficient', () => {
	it('0-6歳は0.3', () => {
		expect(getAgeCoefficient(1)).toBe(0.3);
		expect(getAgeCoefficient(4)).toBe(0.3);
		expect(getAgeCoefficient(6)).toBe(0.3);
	});

	it('7-12歳は0.5', () => {
		expect(getAgeCoefficient(7)).toBe(0.5);
		expect(getAgeCoefficient(12)).toBe(0.5);
	});

	it('13-18歳は0.7', () => {
		expect(getAgeCoefficient(13)).toBe(0.7);
		expect(getAgeCoefficient(18)).toBe(0.7);
	});

	it('19歳以上は0.9', () => {
		expect(getAgeCoefficient(19)).toBe(0.9);
		expect(getAgeCoefficient(20)).toBe(0.9);
	});
});

describe('calcDecay', () => {
	it('活動0日経過なら減少なし', () => {
		expect(calcDecay(0, 4)).toBe(0);
	});

	it('1日未活動（4歳）: 0.3 × 0.1 = 0.03', () => {
		expect(calcDecay(1, 4)).toBeCloseTo(0.03);
	});

	it('3日未活動（4歳）: 0.03 + 0.05×2 = 0.13', () => {
		expect(calcDecay(3, 4)).toBeCloseTo(0.13);
	});

	it('1日未活動（10歳）: 0.5 × 0.1 = 0.05', () => {
		expect(calcDecay(1, 10)).toBeCloseTo(0.05);
	});

	it('5日未活動（15歳）: 0.07 + 0.05×4 = 0.27', () => {
		expect(calcDecay(5, 15)).toBeCloseTo(0.27);
	});
});

describe('calcTrend', () => {
	it('正の変化はup', () => {
		expect(calcTrend(1.0)).toBe('up');
	});

	it('負の変化はdown', () => {
		expect(calcTrend(-1.0)).toBe('down');
	});

	it('小さい変化はstable', () => {
		expect(calcTrend(0.3)).toBe('stable');
		expect(calcTrend(-0.3)).toBe('stable');
		expect(calcTrend(0)).toBe('stable');
	});
});

describe('LEVEL_TABLE', () => {
	it('10段階定義されている', () => {
		expect(LEVEL_TABLE.length).toBe(10);
	});

	it('レベル1から10まで連続', () => {
		for (let i = 0; i < 10; i++) {
			expect(LEVEL_TABLE[i]!.level).toBe(i + 1);
		}
	});
});

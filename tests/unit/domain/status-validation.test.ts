// tests/unit/domain/status-validation.test.ts
// ステータス計算ロジックのユニットテスト

import { describe, expect, it } from 'vitest';
import {
	DECAY_GRACE_DAYS,
	LEVEL_TABLE,
	calcCharacterType,
	calcDecay,
	calcDeviationScore,
	calcExpToNextLevel,
	calcLevel,
	calcStars,
	calcTrend,
	clampDecayFloor,
	getAgeCoefficient,
	getComparisonLabel,
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
	it('スコア割合80%以上で5星', () => {
		expect(calcStars(80, 100)).toBe(5);
		expect(calcStars(100, 100)).toBe(5);
		expect(calcStars(280, 350)).toBe(5);
	});

	it('スコア割合60-79%で4星', () => {
		expect(calcStars(60, 100)).toBe(4);
		expect(calcStars(79, 100)).toBe(4);
	});

	it('スコア割合40-59%で3星', () => {
		expect(calcStars(40, 100)).toBe(3);
		expect(calcStars(59, 100)).toBe(3);
	});

	it('スコア割合20-39%で2星', () => {
		expect(calcStars(20, 100)).toBe(2);
		expect(calcStars(39, 100)).toBe(2);
	});

	it('スコア割合20%未満で1星', () => {
		expect(calcStars(19, 100)).toBe(1);
		expect(calcStars(0, 100)).toBe(1);
	});

	it('maxValueが0の場合は1星', () => {
		expect(calcStars(50, 0)).toBe(1);
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
	it('猶予期間（2日以内）は減少なし', () => {
		expect(calcDecay(0, 4)).toBe(0);
		expect(calcDecay(1, 4)).toBe(0);
		expect(calcDecay(2, 4)).toBe(0);
	});

	it('3日目から減少開始（4歳、normal）: effectiveDays=1, 0.03', () => {
		expect(calcDecay(3, 4, 'normal')).toBeCloseTo(0.03);
	});

	it('5日未活動（4歳、normal）: effectiveDays=3, 0.03 + 0.03×2 = 0.09', () => {
		expect(calcDecay(5, 4, 'normal')).toBeCloseTo(0.09);
	});

	it('3日目（10歳、normal）: effectiveDays=1, 0.05', () => {
		expect(calcDecay(3, 10, 'normal')).toBeCloseTo(0.05);
	});

	it('強度 none は常に0', () => {
		expect(calcDecay(10, 4, 'none')).toBe(0);
		expect(calcDecay(100, 15, 'none')).toBe(0);
	});

	it('強度 gentle は通常の半分', () => {
		const normal = calcDecay(5, 4, 'normal');
		const gentle = calcDecay(5, 4, 'gentle');
		expect(gentle).toBeCloseTo(normal * 0.5);
	});

	it('強度 strict は通常の1.5倍', () => {
		const normal = calcDecay(5, 4, 'normal');
		const strict = calcDecay(5, 4, 'strict');
		expect(strict).toBeCloseTo(normal * 1.5);
	});

	it('デフォルト強度は normal', () => {
		expect(calcDecay(5, 4)).toBeCloseTo(calcDecay(5, 4, 'normal'));
	});

	it('猶予日数定数が2', () => {
		expect(DECAY_GRACE_DAYS).toBe(2);
	});
});

describe('clampDecayFloor', () => {
	it('減少後が下限（70%）以上ならそのまま', () => {
		expect(clampDecayFloor(100, 10, 100)).toBe(90);
	});

	it('減少後が下限を下回る場合は下限で止まる', () => {
		expect(clampDecayFloor(75, 10, 100)).toBe(70);
	});

	it('既に下限以下の場合は下限を維持', () => {
		expect(clampDecayFloor(60, 5, 100)).toBe(70);
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
			expect(LEVEL_TABLE[i]?.level).toBe(i + 1);
		}
	});
});

describe('getComparisonLabel', () => {
	it('偏差値65以上は最高ラベル', () => {
		const result = getComparisonLabel(65);
		expect(result.text).toBe('みんなよりすっごくすごい！');
		expect(result.emoji).toBe('🌟');
	});

	it('偏差値58-64はすごいラベル', () => {
		expect(getComparisonLabel(58).text).toBe('みんなよりすごい！');
		expect(getComparisonLabel(64).text).toBe('みんなよりすごい！');
	});

	it('偏差値50-57は平均ラベル', () => {
		expect(getComparisonLabel(50).text).toBe('みんなとおなじくらい');
		expect(getComparisonLabel(57).text).toBe('みんなとおなじくらい');
	});

	it('偏差値42-49は励ましラベル', () => {
		expect(getComparisonLabel(42).text).toBe('もうちょっとがんばろう！');
		expect(getComparisonLabel(49).text).toBe('もうちょっとがんばろう！');
	});

	it('偏差値41以下は応援ラベル', () => {
		expect(getComparisonLabel(41).text).toBe('いっしょにがんばろう！');
		expect(getComparisonLabel(30).emoji).toBe('🌱');
	});
});

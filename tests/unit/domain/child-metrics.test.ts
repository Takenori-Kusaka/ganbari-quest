// tests/unit/domain/child-metrics.test.ts
// #4697: 親向けレポートの数値定義 SSOT を固定する。
//
// 画面ごとに「レベル」「ポイント」の意味が違っていた (#4697):
//   - `/view/<token>` はカテゴリレベルの合計 (Lv.17)、他画面は最大値 (レベル 5)
//   - 月次レポートの「ポイント」は XP 累計で、どの月を見ても同じ数 → 先月比が常に ±0
//
// 定義そのものをここで固定し、全画面が同じ関数を呼ぶ形を壊せないようにする。

import { describe, expect, it } from 'vitest';
import {
	isFutureMonth,
	MIN_CHILD_LEVEL,
	resolveChildLevel,
	resolveChildTotalXp,
} from '$lib/domain/child-metrics';
import {
	calcDeviationScore,
	DEVIATION_SCORE_MAX,
	DEVIATION_SCORE_MIN,
} from '$lib/domain/validation/status';

describe('resolveChildLevel — レベルは最大値 (合計ではない)', () => {
	it('カテゴリ別レベルの最大値を返す', () => {
		expect(resolveChildLevel([{ level: 4 }, { level: 2 }, { level: 5 }, { level: 3 }])).toBe(5);
	});

	it('合計を返さない (旧 /view/<token> の Lv.17 が出ない)', () => {
		// #4697 の実測値: うんどう 4 / べんきょう 2 / せいかつ 5 / こうりゅう 3 / そうぞう 3
		const statuses = [{ level: 4 }, { level: 2 }, { level: 5 }, { level: 3 }, { level: 3 }];
		expect(resolveChildLevel(statuses)).toBe(5);
		expect(resolveChildLevel(statuses)).not.toBe(17);
	});

	it('status が空でも 1 を返す (活動 0 でもレベル 1 から)', () => {
		expect(resolveChildLevel([])).toBe(MIN_CHILD_LEVEL);
	});

	it('level が null / undefined の行は 1 として扱う', () => {
		expect(resolveChildLevel([{ level: null }, {}])).toBe(1);
	});
});

describe('resolveChildTotalXp — XP は累計の合計', () => {
	it('カテゴリ別 totalXp を合計する', () => {
		expect(resolveChildTotalXp([{ totalXp: 100 }, { totalXp: 60 }, { totalXp: 120 }])).toBe(280);
	});

	it('null / undefined は 0 として扱う', () => {
		expect(resolveChildTotalXp([{ totalXp: null }, {}, { totalXp: 5 }])).toBe(5);
	});

	it('空なら 0', () => {
		expect(resolveChildTotalXp([])).toBe(0);
	});
});

describe('isFutureMonth — 未来月に数値を出さないための判定', () => {
	it('今月は未来ではない', () => {
		expect(isFutureMonth('2026-08', '2026-08-20')).toBe(false);
	});

	it('翌月以降は未来', () => {
		expect(isFutureMonth('2026-09', '2026-08-20')).toBe(true);
		expect(isFutureMonth('2027-03', '2026-08-20')).toBe(true);
	});

	it('過去月は未来ではない', () => {
		expect(isFutureMonth('2026-07', '2026-08-20')).toBe(false);
		expect(isFutureMonth('2025-12', '2026-08-20')).toBe(false);
	});

	it('年度末 (翌年 3 月) を年跨ぎで正しく判定する', () => {
		// 年度は 4 月〜翌 3 月。1 月時点で「翌年 3 月」は未来、「前年 4 月」は過去
		expect(isFutureMonth('2026-03', '2026-01-05')).toBe(true);
		expect(isFutureMonth('2025-04', '2026-01-05')).toBe(false);
	});
});

describe('calcDeviationScore — 偏差値は表示帯にクランプする (#4697)', () => {
	it('平均どおりなら 50', () => {
		expect(calcDeviationScore(30, 30, 9)).toBe(50);
	});

	it('上振れしても上限を超えない (旧実装の「偏差値 187」が出ない)', () => {
		// #4697 実測: 7 日利用の 4 歳が totalXp 120、age 4 の benchmark は mean 30 / sd 9
		// 素の式は (120-30)/9*10+50 = 150
		expect(calcDeviationScore(120, 30, 9)).toBe(DEVIATION_SCORE_MAX);
		expect(calcDeviationScore(10_000, 30, 9)).toBe(DEVIATION_SCORE_MAX);
	});

	it('下振れしても下限を下回らない', () => {
		expect(calcDeviationScore(0, 500, 10)).toBe(DEVIATION_SCORE_MIN);
	});

	it('帯の内側では素の式どおりに動く (クランプが常時かかっていない)', () => {
		expect(calcDeviationScore(39, 30, 9)).toBe(60);
		expect(calcDeviationScore(21, 30, 9)).toBe(40);
	});

	it('標準偏差 0 は 50 (0 除算しない)', () => {
		expect(calcDeviationScore(120, 30, 0)).toBe(50);
	});
});

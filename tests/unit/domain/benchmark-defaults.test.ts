// tests/unit/domain/benchmark-defaults.test.ts
// #4697: ベンチマーク既定値と `/admin/status` のガイド文が同じ表を見ていることを固定する。
//
// 旧実装は DB に seed する既定値 (4 歳で平均 18〜38 XP) と、画面内のガイド式
// `(age - 2) * 80` (4 歳で「平均 128〜240 XP」) が独立していた。桁違いの 2 つの基準が
// 同じ画面に並び、親はどちらに合わせて入力すればよいか判断できなかった。

import { describe, expect, it } from 'vitest';
import {
	BENCHMARK_DEFAULT_MAX_AGE,
	BENCHMARK_DEFAULT_MIN_AGE,
	BENCHMARK_DEFAULTS,
	clampBenchmarkAge,
	getBenchmarkGuideRange,
} from '$lib/domain/benchmark-defaults';
import { CATEGORY_NUMERIC_IDS } from '$lib/domain/categories';

describe('BENCHMARK_DEFAULTS — 3〜12 歳 × 5 カテゴリを欠けなく持つ', () => {
	it('年齢 × カテゴリの全組み合わせが 1 件ずつある', () => {
		for (let age = BENCHMARK_DEFAULT_MIN_AGE; age <= BENCHMARK_DEFAULT_MAX_AGE; age++) {
			for (const categoryId of CATEGORY_NUMERIC_IDS) {
				const rows = BENCHMARK_DEFAULTS.filter((b) => b.age === age && b.categoryId === categoryId);
				expect(rows, `age=${age} category=${categoryId}`).toHaveLength(1);
			}
		}
	});

	it('mean / stdDev はいずれも正の値 (stdDev 0 は偏差値が計算できない)', () => {
		for (const b of BENCHMARK_DEFAULTS) {
			expect(b.mean, `age=${b.age} category=${b.categoryId} mean`).toBeGreaterThan(0);
			expect(b.stdDev, `age=${b.age} category=${b.categoryId} stdDev`).toBeGreaterThan(0);
		}
	});

	it('年齢が上がると各カテゴリの平均も上がる (発達段階モデルの単調性)', () => {
		for (const categoryId of CATEGORY_NUMERIC_IDS) {
			const byAge = BENCHMARK_DEFAULTS.filter((b) => b.categoryId === categoryId).sort(
				(a, b) => a.age - b.age,
			);
			for (let i = 1; i < byAge.length; i++) {
				const prev = byAge[i - 1];
				const cur = byAge[i];
				expect(cur && prev && cur.mean, `category=${categoryId} age=${cur?.age}`).toBeGreaterThan(
					prev?.mean ?? 0,
				);
			}
		}
	});
});

describe('getBenchmarkGuideRange — ガイド文は既定値の実値から出す', () => {
	it('4 歳のガイドが既定値 (mean 18〜38) と同じ桁に収まる', () => {
		const range = getBenchmarkGuideRange(4);
		expect(range).not.toBeNull();
		const age4 = BENCHMARK_DEFAULTS.filter((b) => b.age === 4).map((b) => b.mean);
		expect(range?.meanLow).toBe(Math.round(Math.min(...age4)));
		expect(range?.meanHigh).toBe(Math.round(Math.max(...age4)));
		// 旧ガイド式 `(4-2)*80*0.8 = 128` 〜 `*1.5 = 240` の桁には戻らない
		expect(range?.meanHigh).toBeLessThan(128);
	});

	it('全年齢でガイドのレンジが既定値の min / max と一致する', () => {
		for (let age = BENCHMARK_DEFAULT_MIN_AGE; age <= BENCHMARK_DEFAULT_MAX_AGE; age++) {
			const rows = BENCHMARK_DEFAULTS.filter((b) => b.age === age);
			const range = getBenchmarkGuideRange(age);
			expect(range?.meanLow).toBe(Math.round(Math.min(...rows.map((b) => b.mean))));
			expect(range?.meanHigh).toBe(Math.round(Math.max(...rows.map((b) => b.mean))));
			expect(range?.sdLow).toBe(Math.round(Math.min(...rows.map((b) => b.stdDev))));
			expect(range?.sdHigh).toBe(Math.round(Math.max(...rows.map((b) => b.stdDev))));
		}
	});

	it('既定値を持たない年齢は null (画面はガイド文を出さない)', () => {
		expect(getBenchmarkGuideRange(BENCHMARK_DEFAULT_MIN_AGE - 1)).toBeNull();
		expect(getBenchmarkGuideRange(BENCHMARK_DEFAULT_MAX_AGE + 1)).toBeNull();
	});
});

// #4914: `/admin/status` のベンチマーク年齢選択の初期値が常に 4 固定で、選択中の子供の実年齢
// (例: 8歳) と食い違っていた。
describe('clampBenchmarkAge — ベンチマーク年齢選択の初期値 SSOT', () => {
	it('範囲内 (3〜12) の年齢はそのまま返す', () => {
		expect(clampBenchmarkAge(8)).toBe(8);
		expect(clampBenchmarkAge(BENCHMARK_DEFAULT_MIN_AGE)).toBe(BENCHMARK_DEFAULT_MIN_AGE);
		expect(clampBenchmarkAge(BENCHMARK_DEFAULT_MAX_AGE)).toBe(BENCHMARK_DEFAULT_MAX_AGE);
	});

	it('下限未満は最寄りの下限に丸める (baby モード 0-2歳 等)', () => {
		expect(clampBenchmarkAge(0)).toBe(BENCHMARK_DEFAULT_MIN_AGE);
		expect(clampBenchmarkAge(2)).toBe(BENCHMARK_DEFAULT_MIN_AGE);
	});

	it('上限超過は最寄りの上限に丸める (13歳以上)', () => {
		expect(clampBenchmarkAge(13)).toBe(BENCHMARK_DEFAULT_MAX_AGE);
		expect(clampBenchmarkAge(18)).toBe(BENCHMARK_DEFAULT_MAX_AGE);
	});

	it('undefined (子供 0 名時) は下限にフォールバックする', () => {
		expect(clampBenchmarkAge(undefined)).toBe(BENCHMARK_DEFAULT_MIN_AGE);
	});

	it('小数は最も近い整数に丸めてからクランプする', () => {
		expect(clampBenchmarkAge(8.6)).toBe(9);
		expect(clampBenchmarkAge(8.4)).toBe(8);
	});
});

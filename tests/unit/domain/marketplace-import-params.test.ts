// tests/unit/domain/marketplace-import-params.test.ts
// Issue #2767 Fix Round 1 B3 (Adversarial security): activity-pack subset 取込の
// `?indexes=<csv>` query を Zod ベース helper でパースし、4 edge case の input validation を
// 回帰固定する。
//
// 検証対象:
// - parseImportIndexes (src/lib/domain/validation/marketplace-import-params.ts)
//
// AC マッピング (Adversarial B3):
// - AC-B3-1 (NaN): 'abc' / 'NaN' / '1.5e' などの非数値 token を silent drop する
// - AC-B3-2 (負数): '-1' / '-100' を silent drop する
// - AC-B3-3 (空文字): '' / null / undefined / トリム後空 → null (全件 fallback)
// - AC-B3-4 (重複): '0,0,1,1,2' → [0, 1, 2] (順序保持 + 重複除去)
// - AC-B3-5 (非整数 / 小数): '1.5' / '2.7' を silent drop する
// - AC-B3-6 (正常系): '0,2,5' → [0, 2, 5]
//
// 関連 Issue: #2767 (Round 18 Cluster H)

import { describe, expect, it } from 'vitest';
import { parseImportIndexes } from '$lib/domain/validation/marketplace-import-params';

describe('parseImportIndexes (#2767 Round 1 B3 — Zod input validation)', () => {
	describe('AC-B3-1: NaN / 非数値 token を silent drop', () => {
		it('"abc" → null (全件 fallback)', () => {
			expect(parseImportIndexes('abc')).toBeNull();
		});

		it('"NaN" → null', () => {
			expect(parseImportIndexes('NaN')).toBeNull();
		});

		it('"0,abc,2" → [0, 2] (有効値のみ抽出)', () => {
			expect(parseImportIndexes('0,abc,2')).toEqual([0, 2]);
		});

		it('"foo,bar,baz" → null (全要素 drop → 全件 fallback)', () => {
			expect(parseImportIndexes('foo,bar,baz')).toBeNull();
		});
	});

	describe('AC-B3-2: 負数を silent drop', () => {
		it('"-1" → null', () => {
			expect(parseImportIndexes('-1')).toBeNull();
		});

		it('"-100" → null', () => {
			expect(parseImportIndexes('-100')).toBeNull();
		});

		it('"0,-1,2,-3" → [0, 2] (負数のみ drop)', () => {
			expect(parseImportIndexes('0,-1,2,-3')).toEqual([0, 2]);
		});
	});

	describe('AC-B3-3: 空文字 / null / undefined → null (全件 fallback)', () => {
		it('"" → null', () => {
			expect(parseImportIndexes('')).toBeNull();
		});

		it('"   " (spaces only) → null', () => {
			expect(parseImportIndexes('   ')).toBeNull();
		});

		it('null → null', () => {
			expect(parseImportIndexes(null)).toBeNull();
		});

		it('undefined → null', () => {
			expect(parseImportIndexes(undefined)).toBeNull();
		});

		it('",,," (commas only) → null', () => {
			expect(parseImportIndexes(',,,')).toBeNull();
		});

		it('", , ," (commas + spaces) → null', () => {
			expect(parseImportIndexes(', , ,')).toBeNull();
		});
	});

	describe('AC-B3-4: 重複除去 + 並び順保持', () => {
		it('"0,0,1,1,2" → [0, 1, 2] (重複除去)', () => {
			expect(parseImportIndexes('0,0,1,1,2')).toEqual([0, 1, 2]);
		});

		it('"5,3,5,3,1" → [5, 3, 1] (出現順保持)', () => {
			expect(parseImportIndexes('5,3,5,3,1')).toEqual([5, 3, 1]);
		});

		it('"10,10,10" → [10] (全重複)', () => {
			expect(parseImportIndexes('10,10,10')).toEqual([10]);
		});
	});

	describe('AC-B3-5: 非整数 (小数 / Infinity) を silent drop', () => {
		it('"1.5" → null', () => {
			expect(parseImportIndexes('1.5')).toBeNull();
		});

		it('"0,1.5,2,2.7" → [0, 2] (小数は drop)', () => {
			expect(parseImportIndexes('0,1.5,2,2.7')).toEqual([0, 2]);
		});

		it('"Infinity" → null', () => {
			expect(parseImportIndexes('Infinity')).toBeNull();
		});

		it('"0,Infinity,3" → [0, 3]', () => {
			expect(parseImportIndexes('0,Infinity,3')).toEqual([0, 3]);
		});
	});

	describe('AC-B3-6: 正常系', () => {
		it('"0" → [0] (単一値)', () => {
			expect(parseImportIndexes('0')).toEqual([0]);
		});

		it('"0,1,2" → [0, 1, 2]', () => {
			expect(parseImportIndexes('0,1,2')).toEqual([0, 1, 2]);
		});

		it('"0,2,5,8" → [0, 2, 5, 8] (sparse)', () => {
			expect(parseImportIndexes('0,2,5,8')).toEqual([0, 2, 5, 8]);
		});

		it('" 0 , 2 , 5 " (whitespace 混入) → [0, 2, 5]', () => {
			expect(parseImportIndexes(' 0 , 2 , 5 ')).toEqual([0, 2, 5]);
		});

		it('large index "30,100,500" → [30, 100, 500] (上限は呼び出し側担保)', () => {
			expect(parseImportIndexes('30,100,500')).toEqual([30, 100, 500]);
		});
	});

	describe('複合 edge case (Adversarial)', () => {
		it('"0,-1,1.5,abc,2,2" → [0, 2] (混在 → 有効値のみ + 重複除去)', () => {
			expect(parseImportIndexes('0,-1,1.5,abc,2,2')).toEqual([0, 2]);
		});

		it('"abc,-1,1.5,NaN" → null (全要素 invalid → 全件 fallback)', () => {
			expect(parseImportIndexes('abc,-1,1.5,NaN')).toBeNull();
		});
	});
});

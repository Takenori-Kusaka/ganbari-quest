// tests/unit/domain/categories.test.ts
// カテゴリ SSOT ($lib/domain/categories.ts) の網羅性・整合性検証 (#3607 AC4)。
//
// 目的: 「カテゴリを 1 件追加した場合に全消費側が compile error になる」ことを型レベルで
// 担保する。CategoryCode / CategoryNumericId は SSOT オブジェクトから派生する union のため、
// SSOT に 6 番目のカテゴリを追記すると本 file の expectTypeOf / satisfies が即 fail し、
// 消費側 (Record<CategoryCode, ...> / picklist / literal union) の追随修正を強制する。

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	CATEGORIES,
	CATEGORY_CODE_TO_ID,
	CATEGORY_CODES,
	CATEGORY_ID_TO_CODE,
	CATEGORY_NUMERIC_IDS,
	type CategoryCode,
	type CategoryName,
	type CategoryNumericId,
	toCategoryCode,
	toLegacyCategoryId,
} from '$lib/domain/categories';

describe('categories SSOT (#3607)', () => {
	describe('型レベル網羅性 (AC4)', () => {
		it('CategoryCode union が SSOT キーと一致する (カテゴリ追加時はここが fail し消費側追随を強制)', () => {
			expectTypeOf<CategoryCode>().toEqualTypeOf<
				'undou' | 'benkyou' | 'seikatsu' | 'kouryuu' | 'souzou'
			>();
		});

		it('CategoryNumericId union が 1-5 と一致する', () => {
			expectTypeOf<CategoryNumericId>().toEqualTypeOf<1 | 2 | 3 | 4 | 5>();
		});

		it('CategoryName union が日本語表示名と一致する', () => {
			expectTypeOf<CategoryName>().toEqualTypeOf<
				'うんどう' | 'べんきょう' | 'せいかつ' | 'こうりゅう' | 'そうぞう'
			>();
		});

		it('派生マップは union 上で total (Record<CategoryNumericId, CategoryCode> / 逆向き)', () => {
			expectTypeOf(CATEGORY_ID_TO_CODE).toEqualTypeOf<Record<CategoryNumericId, CategoryCode>>();
			expectTypeOf(CATEGORY_CODE_TO_ID).toEqualTypeOf<Record<CategoryCode, CategoryNumericId>>();
		});

		it('消費側パターンの網羅性デモ: Record<CategoryCode, T> はカテゴリ追加で compile error になる', () => {
			// battle-types.ts CATEGORY_TO_STAT / activity-types.ts CATEGORY_INFO 等と同型。
			// SSOT にカテゴリを追加すると本 satisfies が missing key で即 fail する。
			const perCategory = {
				undou: 1,
				benkyou: 2,
				seikatsu: 3,
				kouryuu: 4,
				souzou: 5,
			} satisfies Record<CategoryCode, number>;
			expect(Object.keys(perCategory)).toHaveLength(CATEGORY_CODES.length);
		});
	});

	describe('runtime 整合性', () => {
		it('CATEGORY_CODES / CATEGORY_NUMERIC_IDS は SSOT 定義順 (legacyNumericId 昇順) に並ぶ', () => {
			expect(CATEGORY_CODES).toEqual(['undou', 'benkyou', 'seikatsu', 'kouryuu', 'souzou']);
			expect(CATEGORY_NUMERIC_IDS).toEqual([1, 2, 3, 4, 5]);
		});

		it('legacyNumericId は重複なし (id↔code 全単射)', () => {
			const ids = CATEGORY_CODES.map((code) => CATEGORIES[code].legacyNumericId);
			expect(new Set(ids).size).toBe(CATEGORY_CODES.length);
		});

		it('CATEGORY_ID_TO_CODE と CATEGORY_CODE_TO_ID は互いに逆写像', () => {
			for (const code of CATEGORY_CODES) {
				expect(CATEGORY_ID_TO_CODE[CATEGORY_CODE_TO_ID[code]]).toBe(code);
			}
			for (const id of CATEGORY_NUMERIC_IDS) {
				expect(CATEGORY_CODE_TO_ID[CATEGORY_ID_TO_CODE[id]]).toBe(id);
			}
		});

		it('表示メタ (name / icon) が従来値を維持する (behavior-preserving、AC6)', () => {
			expect(CATEGORIES.undou).toMatchObject({ name: 'うんどう', icon: '🏃' });
			expect(CATEGORIES.benkyou).toMatchObject({ name: 'べんきょう', icon: '📚' });
			expect(CATEGORIES.seikatsu).toMatchObject({ name: 'せいかつ', icon: '🏠' });
			expect(CATEGORIES.kouryuu).toMatchObject({ name: 'こうりゅう', icon: '🤝' });
			expect(CATEGORIES.souzou).toMatchObject({ name: 'そうぞう', icon: '🎨' });
		});
	});

	describe('境界 helper (未検証入力)', () => {
		it('toCategoryCode: 数値 / branded 文字列 id の両方を受ける', () => {
			expect(toCategoryCode(1)).toBe('undou');
			expect(toCategoryCode('3')).toBe('seikatsu');
			expect(toCategoryCode(5)).toBe('souzou');
		});

		it('toCategoryCode: 未知 id は undefined (silent fallback しない)', () => {
			expect(toCategoryCode(6)).toBeUndefined();
			expect(toCategoryCode(0)).toBeUndefined();
			expect(toCategoryCode('unknown')).toBeUndefined();
		});

		it('toLegacyCategoryId: 既知 code は数値 id、未知 code は undefined', () => {
			expect(toLegacyCategoryId('undou')).toBe(1);
			expect(toLegacyCategoryId('souzou')).toBe(5);
			expect(toLegacyCategoryId('nonexistent')).toBeUndefined();
			expect(toLegacyCategoryId('')).toBeUndefined();
		});
	});
});

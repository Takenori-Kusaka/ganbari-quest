import { describe, expect, it } from 'vitest';

import { parseBlock, parseSimpleBlock } from '../../../scripts/generate-lp-labels.mjs';

describe('generate-lp-labels (#1772)', () => {
	describe('parseBlock', () => {
		it('単純な key: value ブロックをパースする', () => {
			const src = `
export const LP_NAV_LABELS = {
	home: 'ホーム',
	about: 'について',
} as const;
`;
			const result = parseBlock(src, 'LP_NAV_LABELS');
			expect(result).toEqual({ home: 'ホーム', about: 'について' });
		});

		it('Biome multi-line 形式 (key: 改行 value) をパースする', () => {
			const src = `
export const LP_TEST_LABELS = {
	multilineKey:
		'value on next line',
	normalKey: 'inline',
} as const;
`;
			const result = parseBlock(src, 'LP_TEST_LABELS');
			expect(result).toEqual({
				multilineKey: 'value on next line',
				normalKey: 'inline',
			});
		});

		it('#1772: 定数が存在しない場合は空オブジェクトを返す（throw しない）', () => {
			// LP_FOUNDER_INQUIRY_LABELS のように、別 PR で完全削除された定数を
			// parseBlock が参照しても本スクリプトが壊れないことを保証する。
			const src = `
export const LP_NAV_LABELS = { home: 'ホーム' } as const;
`;
			// 存在しない定数を要求しても throw しないこと
			expect(() => parseBlock(src, 'LP_REMOVED_LABELS')).not.toThrow();
			// 戻り値は空オブジェクトであること
			expect(parseBlock(src, 'LP_REMOVED_LABELS')).toEqual({});
		});

		it('複数の export を含む src 内から指定の定数だけを抽出する', () => {
			const src = `
export const LP_NAV_LABELS = { home: 'ホーム' } as const;
export const LP_FOOTER_LABELS = {
	copyright: '(c) 2026',
	contactLink: 'mailto:test@example.com',
} as const;
`;
			expect(parseBlock(src, 'LP_FOOTER_LABELS')).toEqual({
				copyright: '(c) 2026',
				contactLink: 'mailto:test@example.com',
			});
		});

		it('空オブジェクト { } の定数も throw せず空辞書を返す', () => {
			// #1770 で空オブジェクト化したフェーズの後方互換確認
			const src = `
export const LP_EMPTY_LABELS = {} as const;
`;
			expect(parseBlock(src, 'LP_EMPTY_LABELS')).toEqual({});
		});
	});

	describe('parseSimpleBlock', () => {
		it('単純な行単位ブロックをパースする', () => {
			const src = `
export const AGE_TIER_LABELS = {
	baby: '準備モード（0〜2歳）',
	preschool: '幼児（3〜5歳）',
} as const;
`;
			const result = parseSimpleBlock(src, 'AGE_TIER_LABELS');
			expect(result).toEqual({
				baby: '準備モード（0〜2歳）',
				preschool: '幼児（3〜5歳）',
			});
		});

		it('定数が存在しない場合は throw する（既存挙動）', () => {
			// parseSimpleBlock は AGE_TIER_LABELS / PLAN_LABELS など必須定数専用のため
			// 互換性の理由で従来挙動 (throw) を維持する
			const src = `export const FOO = {} as const;`;
			expect(() => parseSimpleBlock(src, 'NOT_EXIST')).toThrow(/NOT_EXIST not found/);
		});
	});
});

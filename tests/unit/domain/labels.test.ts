// tests/unit/domain/labels.test.ts
// 用語辞書 (labels.ts) のユニットテスト
// #573: 内部コード (kinder/lower/upper/teen) が UI に漏れる回帰防止

import { describe, expect, it } from 'vitest';
import {
	AGE_TIER_LABELS,
	AGE_TIER_SHORT_LABELS,
	getAgeTierLabel,
	getAgeTierShortLabel,
	NAV_ITEM_LABELS,
} from '../../../src/lib/domain/labels';

describe('getAgeTierLabel', () => {
	it('標準的な UiMode コードを日本語ラベルに変換する', () => {
		expect(getAgeTierLabel('baby')).toBe(AGE_TIER_LABELS.baby);
		expect(getAgeTierLabel('preschool')).toBe(AGE_TIER_LABELS.preschool);
		expect(getAgeTierLabel('elementary')).toBe(AGE_TIER_LABELS.elementary);
		expect(getAgeTierLabel('junior')).toBe(AGE_TIER_LABELS.junior);
		expect(getAgeTierLabel('senior')).toBe(AGE_TIER_LABELS.senior);
	});

	it('#573: レガシーコード kinder を preschool ラベルに変換する', () => {
		expect(getAgeTierLabel('kinder')).toBe(AGE_TIER_LABELS.preschool);
	});

	it('#573: レガシーコード lower を elementary ラベルに変換する', () => {
		expect(getAgeTierLabel('lower')).toBe(AGE_TIER_LABELS.elementary);
	});

	it('#573: レガシーコード upper を junior ラベルに変換する', () => {
		expect(getAgeTierLabel('upper')).toBe(AGE_TIER_LABELS.junior);
	});

	it('#573: レガシーコード teen を senior ラベルに変換する', () => {
		expect(getAgeTierLabel('teen')).toBe(AGE_TIER_LABELS.senior);
	});

	it('#573: 未知のコードでも内部コードを直接露出せず fallback を返す', () => {
		const result = getAgeTierLabel('unknown-code');
		// 未知のコードは preschool 扱い（内部コードが UI に漏れないことを保証）
		expect(result).toBe(AGE_TIER_LABELS.preschool);
		// 生の内部コードが返らないことを明示的に確認
		expect(result).not.toContain('unknown-code');
		expect(result).not.toContain('kinder');
	});

	it('#573: null / undefined / 空文字は fallback ラベルを返す', () => {
		expect(getAgeTierLabel(null)).toBe(AGE_TIER_LABELS.preschool);
		expect(getAgeTierLabel(undefined)).toBe(AGE_TIER_LABELS.preschool);
		expect(getAgeTierLabel('')).toBe(AGE_TIER_LABELS.preschool);
	});

	it('#573: 返り値は常に日本語ラベル（英語コードを含まない）', () => {
		const inputs = [
			'baby',
			'preschool',
			'elementary',
			'junior',
			'senior',
			'kinder',
			'lower',
			'upper',
			'teen',
			'unknown',
			null,
			undefined,
		];
		for (const input of inputs) {
			const label = getAgeTierLabel(input);
			// 英語の内部コードが漏れていないことを確認
			expect(label).not.toMatch(
				/^(baby|preschool|elementary|junior|senior|kinder|lower|upper|teen)$/,
			);
		}
	});
});

describe('getAgeTierShortLabel', () => {
	it('標準的な UiMode コードを短縮ラベルに変換する', () => {
		expect(getAgeTierShortLabel('baby')).toBe(AGE_TIER_SHORT_LABELS.baby);
		expect(getAgeTierShortLabel('preschool')).toBe(AGE_TIER_SHORT_LABELS.preschool);
		expect(getAgeTierShortLabel('elementary')).toBe(AGE_TIER_SHORT_LABELS.elementary);
	});

	it('#573: レガシーコードを短縮ラベルに変換する', () => {
		expect(getAgeTierShortLabel('kinder')).toBe(AGE_TIER_SHORT_LABELS.preschool);
		expect(getAgeTierShortLabel('lower')).toBe(AGE_TIER_SHORT_LABELS.elementary);
		expect(getAgeTierShortLabel('upper')).toBe(AGE_TIER_SHORT_LABELS.junior);
		expect(getAgeTierShortLabel('teen')).toBe(AGE_TIER_SHORT_LABELS.senior);
	});

	it('#573: 未知のコードは fallback を返す', () => {
		expect(getAgeTierShortLabel('xxx')).toBe(AGE_TIER_SHORT_LABELS.preschool);
	});

	it('#573: null / undefined は fallback を返す', () => {
		expect(getAgeTierShortLabel(null)).toBe(AGE_TIER_SHORT_LABELS.preschool);
		expect(getAgeTierShortLabel(undefined)).toBe(AGE_TIER_SHORT_LABELS.preschool);
	});
});

describe('NAV_ITEM_LABELS', () => {
	it('#1170: マケプレをグローバルナビに昇格 → #1212-H ADR-0041 テンプレート呼称へ移行', () => {
		expect(NAV_ITEM_LABELS.marketplace).toBe('テンプレート');
	});
});

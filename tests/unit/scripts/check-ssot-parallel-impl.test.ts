import { describe, expect, it } from 'vitest';

import {
	compareNamespaces,
	diffSet,
	extractLabelsTsLpNamespaces,
	extractSharedLabelsJsLpNamespaces,
	shortNameToLabelsTsName,
} from '../../../scripts/check-ssot-parallel-impl.mjs';

describe('check-ssot-parallel-impl (#1739)', () => {
	describe('extractLabelsTsLpNamespaces', () => {
		it('単純な LP_*_LABELS namespace を抽出する', () => {
			const src = `
export const FOO = { x: 'y' } as const;
export const LP_NAV_LABELS = {
	home: 'ホーム',
	about: 'について',
} as const;
export const LP_FOOTER_LABELS = {
	copyright: '(c) 2026',
} as const;
`;
			const result = extractLabelsTsLpNamespaces(src);
			expect(result.size).toBe(2);
			expect([...result.keys()].sort()).toEqual(['LP_FOOTER_LABELS', 'LP_NAV_LABELS']);
			expect(result.get('LP_NAV_LABELS')).toEqual(new Set(['home', 'about']));
			expect(result.get('LP_FOOTER_LABELS')).toEqual(new Set(['copyright']));
		});

		it('Biome multi-line 形式 (key: 改行 value) も抽出する', () => {
			const src = `
export const LP_TEST_LABELS = {
	multilineKey:
		'value on next line',
	normalKey: 'inline',
} as const;
`;
			const result = extractLabelsTsLpNamespaces(src);
			expect(result.get('LP_TEST_LABELS')).toEqual(new Set(['multilineKey', 'normalKey']));
		});

		it('LP_ で始まらない export は無視する', () => {
			const src = `
export const APP_LABELS = { home: 'ホーム' } as const;
export const LP_NAV_LABELS = { x: 'y' } as const;
`;
			const result = extractLabelsTsLpNamespaces(src);
			expect([...result.keys()]).toEqual(['LP_NAV_LABELS']);
		});

		it('ネストしたオブジェクトの内部 key は top-level として含めない', () => {
			const src = `
export const LP_NESTED_LABELS = {
	outer: 'top',
	nested: {
		inner: 'should not appear at top level',
	},
} as const;
`;
			const result = extractLabelsTsLpNamespaces(src);
			const keys = result.get('LP_NESTED_LABELS');
			expect(keys?.has('outer')).toBe(true);
			expect(keys?.has('nested')).toBe(true);
			expect(keys?.has('inner')).toBe(false);
		});
	});

	describe('extractSharedLabelsJsLpNamespaces', () => {
		it('LP_LABELS の top-level namespace と key を抽出する', () => {
			const src = `
(function () {
	const LP_LABELS = {
		"retention": {
			"sectionTitle": "三日坊主にならない設計",
			"point1": "ポイント 1"
		},
		"nav": {
			"home": "ホーム"
		}
	};
})();
`;
			const result = extractSharedLabelsJsLpNamespaces(src);
			// "retention" → "LP_RETENTION_LABELS", "nav" → "LP_NAV_LABELS"
			expect(result.has('LP_RETENTION_LABELS')).toBe(true);
			expect(result.has('LP_NAV_LABELS')).toBe(true);
			expect(result.get('LP_RETENTION_LABELS')).toEqual(new Set(['sectionTitle', 'point1']));
		});

		it('LP_LABELS が見つからない場合は throw する', () => {
			const src = `(function () { const NOT_LP = {}; })();`;
			expect(() => extractSharedLabelsJsLpNamespaces(src)).toThrow(/LP_LABELS not found/);
		});
	});

	describe('shortNameToLabelsTsName', () => {
		it.each([
			['retention', 'LP_RETENTION_LABELS'],
			['coreloop', 'LP_CORELOOP_LABELS'],
			['nav', 'LP_NAV_LABELS'],
			['founderInquiry', 'LP_FOUNDER_INQUIRY_LABELS'],
			['licenseKey', 'LP_LICENSEKEY_LABELS'],
			['growthRoadmap', 'LP_GROWTH_ROADMAP_LABELS'],
			['legalDisclaimer', 'LP_LEGAL_DISCLAIMER_LABELS'],
			['indexExtra', 'LP_INDEX_EXTRA_LABELS'],
			['pricingExtra', 'LP_PRICING_EXTRA_LABELS'],
			['indexB', 'LP_INDEX_PHASEB_LABELS'],
			['pricingB', 'LP_PRICING_PHASEB_LABELS'],
			['faqB', 'LP_FAQ_PHASEB_LABELS'],
			['pamphletB', 'LP_PAMPHLET_PHASEB_LABELS'],
		])('%s → %s', (input, expected) => {
			expect(shortNameToLabelsTsName(input)).toBe(expected);
		});

		it('alias (lpFaqLabels 等) は null を返す', () => {
			expect(shortNameToLabelsTsName('lpLicenseKeyLabels')).toBeNull();
			expect(shortNameToLabelsTsName('lpFaqLabels')).toBeNull();
			expect(shortNameToLabelsTsName('lpSelfhostLabels')).toBeNull();
		});
	});

	describe('diffSet', () => {
		it('A - B (A にあって B に無い) を返す', () => {
			const a = new Set([1, 2, 3]);
			const b = new Set([2, 3, 4]);
			expect([...diffSet(a, b)]).toEqual([1]);
			expect([...diffSet(b, a)]).toEqual([4]);
		});

		it('完全一致なら空集合', () => {
			const a = new Set([1, 2]);
			const b = new Set([1, 2]);
			expect(diffSet(a, b).size).toBe(0);
		});
	});

	describe('compareNamespaces', () => {
		it('完全一致なら空配列を返す', () => {
			const tsNs = new Map([['LP_NAV_LABELS', new Set(['home', 'about'])]]);
			const jsNs = new Map([['LP_NAV_LABELS', new Set(['home', 'about'])]]);
			expect(compareNamespaces(tsNs, jsNs, new Set())).toEqual([]);
		});

		it('labels.ts のみに存在する namespace を検出する', () => {
			const tsNs = new Map([
				['LP_NAV_LABELS', new Set(['home'])],
				['LP_NEW_LABELS', new Set(['x'])],
			]);
			const jsNs = new Map([['LP_NAV_LABELS', new Set(['home'])]]);
			const errors = compareNamespaces(tsNs, jsNs, new Set());
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatch(/labels\.ts に存在するが shared-labels\.js に無い namespace/);
			expect(errors[0]).toMatch(/LP_NEW_LABELS/);
		});

		it('shared-labels.js のみに存在する namespace を検出する', () => {
			const tsNs = new Map([['LP_NAV_LABELS', new Set(['home'])]]);
			const jsNs = new Map([
				['LP_NAV_LABELS', new Set(['home'])],
				['LP_GHOST_LABELS', new Set(['x'])],
			]);
			const errors = compareNamespaces(tsNs, jsNs, new Set());
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatch(/shared-labels\.js に存在するが labels\.ts に無い namespace/);
			expect(errors[0]).toMatch(/LP_GHOST_LABELS/);
		});

		it('共通 namespace の key 抜けを検出する', () => {
			const tsNs = new Map([['LP_NAV_LABELS', new Set(['home', 'about', 'contact'])]]);
			const jsNs = new Map([['LP_NAV_LABELS', new Set(['home'])]]);
			const errors = compareNamespaces(tsNs, jsNs, new Set());
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatch(/labels\.ts に存在するが shared-labels\.js に無い key/);
			expect(errors[0]).toMatch(/about/);
			expect(errors[0]).toMatch(/contact/);
		});

		it('除外リストの namespace は labels.ts にあっても無視する', () => {
			const tsNs = new Map([
				['LP_NAV_LABELS', new Set(['home'])],
				['LP_HERO_PRICE_BAND_LABELS', new Set(['price'])],
			]);
			const jsNs = new Map([['LP_NAV_LABELS', new Set(['home'])]]);
			const excluded = new Set(['LP_HERO_PRICE_BAND_LABELS']);
			expect(compareNamespaces(tsNs, jsNs, excluded)).toEqual([]);
		});

		it('shared-labels.js 側の null マッピング (alias) は無視する', () => {
			const tsNs = new Map([['LP_NAV_LABELS', new Set(['home'])]]);
			const jsNs = new Map<string | null, Set<string>>([
				['LP_NAV_LABELS', new Set(['home'])],
				[null, new Set(['ignored'])],
			]);
			expect(
				compareNamespaces(tsNs, jsNs as unknown as Map<string, Set<string>>, new Set()),
			).toEqual([]);
		});

		it('5 件超の key 不整合は省略表示する', () => {
			const tsNs = new Map([
				['LP_NAV_LABELS', new Set(['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'])],
			]);
			const jsNs = new Map([['LP_NAV_LABELS', new Set<string>()]]);
			const errors = compareNamespaces(tsNs, jsNs, new Set());
			expect(errors[0]).toMatch(/7 件/);
			expect(errors[0]).toMatch(/\.\.\./);
		});
	});
});

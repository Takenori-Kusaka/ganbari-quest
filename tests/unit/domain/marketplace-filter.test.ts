// tests/unit/domain/marketplace-filter.test.ts
// #1171: マケプレ フィルタ UI 刷新の検証。
// - AGE_BANDS が age-tier.ts の 5 モード (UiMode) と一致していること
// - labels.ts の MARKETPLACE_FILTER_LABELS が SSOT として提供されていること
// - build-time データに gender のデフォルトが neutral として埋まること

import { describe, expect, it } from 'vitest';
import { getMarketplaceIndex } from '../../../src/lib/data/marketplace';
import { MARKETPLACE_FILTER_LABELS } from '../../../src/lib/domain/labels';
import { AGE_BANDS } from '../../../src/lib/domain/marketplace-item';
import { AGE_TIER_CONFIG } from '../../../src/lib/domain/validation/age-tier';
import { UI_MODES } from '../../../src/lib/domain/validation/age-tier-types';

describe('#1171 AGE_BANDS は age-tier の 5 モードに統一されている', () => {
	it('id の集合が UI_MODES と完全一致する', () => {
		const bandIds = AGE_BANDS.map((b) => b.id).sort();
		expect(bandIds).toEqual([...UI_MODES].sort());
	});

	it('各 band の min/max が AGE_TIER_CONFIG と一致する', () => {
		for (const band of AGE_BANDS) {
			const config = AGE_TIER_CONFIG[band.id];
			expect(band.min, `${band.id}.min`).toBe(config.ageMin);
			expect(band.max, `${band.id}.max`).toBe(config.ageMax);
		}
	});

	it('label は内部コード (kinder/lower/upper/teen 等) を露出しない', () => {
		for (const band of AGE_BANDS) {
			expect(band.label).not.toMatch(/^(baby|preschool|elementary|junior|senior)$/);
			expect(band.label).not.toContain('kinder');
			expect(band.label).not.toContain('lower');
		}
	});
});

describe('#1171 MARKETPLACE_FILTER_LABELS SSOT', () => {
	it('フィルタ UI で使う全ラベルが定義されている', () => {
		expect(MARKETPLACE_FILTER_LABELS.sectionTitle).toBe('しぼりこむ');
		expect(MARKETPLACE_FILTER_LABELS.age).toBeTruthy();
		expect(MARKETPLACE_FILTER_LABELS.gender).toBeTruthy();
		expect(MARKETPLACE_FILTER_LABELS.sort).toBeTruthy();
		expect(MARKETPLACE_FILTER_LABELS.reset).toBeTruthy();
		expect(MARKETPLACE_FILTER_LABELS.open).toBeTruthy();
	});

	it('性別オプションは all/boy/girl/neutral の 4 種', () => {
		expect(Object.keys(MARKETPLACE_FILTER_LABELS.genderOptions).sort()).toEqual([
			'all',
			'boy',
			'girl',
			'neutral',
		]);
	});

	it('ソートオプションは popularity/newest/ageFit の 3 種', () => {
		expect(Object.keys(MARKETPLACE_FILTER_LABELS.sortOptions).sort()).toEqual([
			'ageFit',
			'newest',
			'popularity',
		]);
	});

	it('resultCount は件数を "N件" で返す', () => {
		expect(MARKETPLACE_FILTER_LABELS.resultCount(0)).toBe('0件');
		expect(MARKETPLACE_FILTER_LABELS.resultCount(12)).toBe('12件');
	});
});

describe('#1171 build-time marketplace index の gender デフォルト', () => {
	it('gender 未指定のアイテムは neutral として取得される', () => {
		const items = getMarketplaceIndex();
		expect(items.length).toBeGreaterThan(0);
		for (const item of items) {
			expect(['boy', 'girl', 'neutral']).toContain(item.gender);
		}
	});
});

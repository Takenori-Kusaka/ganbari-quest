// tests/unit/domain/activity-pack-data.test.ts
// 活動パック JSON のスキーマ整合性テスト (#581 / #1212-A で marketplace SSOT へ移行)

import { describe, expect, it } from 'vitest';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';
import { CATEGORY_CODES, GRADE_LEVELS } from '$lib/domain/validation/activity';

const activityPackMetas = getMarketplaceIndex().filter((m) => m.type === 'activity-pack');

describe('活動パックインデックス (marketplace SSOT)', () => {
	it('活動パックが 12 件登録されている (4 年齢 × neutral + 8 性別バリアント、#1301 baby 3 件削除)', () => {
		expect(activityPackMetas).toHaveLength(12);
	});

	it('itemCount がパック内の実際の活動数と一致する', () => {
		for (const meta of activityPackMetas) {
			const pack = getMarketplaceItem('activity-pack', meta.itemId);
			expect(pack).not.toBeNull();
			if (!pack) continue;
			const payload = pack.payload as ActivityPackPayload;
			expect(payload.activities.length).toBe(meta.itemCount);
		}
	});
});

const PACK_IDS = [
	'kinder-starter',
	'kinder-boy',
	'kinder-girl',
	'elementary-challenge',
	'elementary-boy',
	'elementary-girl',
	'junior-high-challenge',
	'junior-boy',
	'junior-girl',
	'senior-high-challenge',
	'senior-boy',
	'senior-girl',
] as const;

describe.each(PACK_IDS)('パック: %s', (packId) => {
	it('マーケットプレイスから取得できる', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		expect(pack).not.toBeNull();
	});

	it('type が activity-pack', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		expect(pack.type).toBe('activity-pack');
	});

	it('itemId が正しい', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		expect(pack.itemId).toBe(packId);
	});

	it('必須フィールドが存在する', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		expect(pack.name).not.toBe('');
		expect(pack.description).not.toBe('');
		expect(pack.icon).not.toBe('');
		expect(typeof pack.targetAgeMin).toBe('number');
		expect(typeof pack.targetAgeMax).toBe('number');
		expect(pack.tags.length).toBeGreaterThan(0);
		expect(pack.personas.length).toBeGreaterThan(0);
		expect(pack.curator).toBe('official');
	});

	it('活動が 1 つ以上存在する', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		expect(payload.activities.length).toBeGreaterThan(0);
	});

	it('全活動の categoryCode が有効', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		for (const activity of payload.activities) {
			expect(CATEGORY_CODES).toContain(activity.categoryCode);
		}
	});

	it('全活動の gradeLevel が有効（null 許容）', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		for (const activity of payload.activities) {
			if (activity.gradeLevel !== null) {
				expect(GRADE_LEVELS).toContain(activity.gradeLevel);
			}
		}
	});

	it('全活動の basePoints が正の整数', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		for (const activity of payload.activities) {
			expect(activity.basePoints).toBeGreaterThan(0);
			expect(Number.isInteger(activity.basePoints)).toBe(true);
		}
	});

	it('全活動に name がある', () => {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		for (const activity of payload.activities) {
			expect(activity.name).not.toBe('');
		}
	});
});

describe('中学生チャレンジ (junior-high-challenge)', () => {
	it('gradeLevel が middle_school', () => {
		const pack = getMarketplaceItem('activity-pack', 'junior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		for (const activity of payload.activities) {
			expect(activity.gradeLevel).toBe('middle_school');
		}
	});

	it('5 カテゴリをカバー', () => {
		const pack = getMarketplaceItem('activity-pack', 'junior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		const categories = new Set(payload.activities.map((a) => a.categoryCode));
		expect(categories.size).toBe(5);
	});
});

describe('高校生チャレンジ (senior-high-challenge)', () => {
	it('gradeLevel が high_school', () => {
		const pack = getMarketplaceItem('activity-pack', 'senior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		for (const activity of payload.activities) {
			expect(activity.gradeLevel).toBe('high_school');
		}
	});

	it('5 カテゴリをカバー', () => {
		const pack = getMarketplaceItem('activity-pack', 'senior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		const payload = pack.payload as ActivityPackPayload;
		const categories = new Set(payload.activities.map((a) => a.categoryCode));
		expect(categories.size).toBe(5);
	});
});

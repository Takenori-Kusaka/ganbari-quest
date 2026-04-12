// tests/unit/domain/activity-pack-data.test.ts
// 活動パック JSON のスキーマ整合性テスト (#581)

import { describe, expect, it } from 'vitest';
import {
	activityPackIndex,
	getActivityPack,
	getActivityPackIds,
} from '$lib/data/activity-packs/index';
import { CATEGORY_CODES, GRADE_LEVELS } from '$lib/domain/validation/activity';

describe('活動パックインデックス', () => {
	it('formatVersion が 1.0', () => {
		expect(activityPackIndex.formatVersion).toBe('1.0');
	});

	it('16パック登録されている', () => {
		expect(activityPackIndex.packs).toHaveLength(16);
	});

	it('全パックIDがインデックスに存在する', () => {
		const indexIds = activityPackIndex.packs.map((p) => p.packId);
		const loaderIds = getActivityPackIds();
		expect(loaderIds.sort()).toEqual(indexIds.sort());
	});

	it('activityCount がパック内の実際の活動数と一致する', () => {
		for (const meta of activityPackIndex.packs) {
			const pack = getActivityPack(meta.packId);
			expect(pack).not.toBeNull();
			if (!pack) continue;
			expect(pack.activities.length).toBe(meta.activityCount);
		}
	});
});

describe.each([
	'baby-first',
	'baby-boy',
	'baby-girl',
	'kinder-starter',
	'kinder-boy',
	'kinder-girl',
	'elementary-challenge',
	'elementary-boy',
	'elementary-girl',
	'otetsudai-master',
	'junior-high-challenge',
	'junior-boy',
	'junior-girl',
	'senior-high-challenge',
	'senior-boy',
	'senior-girl',
])('パック: %s', (packId) => {
	it('ローダーから取得できる', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
	});

	it('formatVersion が 1.0', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.formatVersion).toBe('1.0');
	});

	it('packId が正しい', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.packId).toBe(packId);
	});

	it('必須フィールドが存在する', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.packName).not.toBe('');
		expect(pack.description).not.toBe('');
		expect(pack.icon).not.toBe('');
		expect(typeof pack.targetAgeMin).toBe('number');
		expect(typeof pack.targetAgeMax).toBe('number');
		expect(pack.tags.length).toBeGreaterThan(0);
	});

	it('活動が1つ以上存在する', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.activities.length).toBeGreaterThan(0);
	});

	it('全活動の categoryCode が有効', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		for (const activity of pack.activities) {
			expect(CATEGORY_CODES).toContain(activity.categoryCode);
		}
	});

	it('全活動の gradeLevel が有効（null 許容）', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		for (const activity of pack.activities) {
			if (activity.gradeLevel !== null) {
				expect(GRADE_LEVELS).toContain(activity.gradeLevel);
			}
		}
	});

	it('全活動の basePoints が正の整数', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		for (const activity of pack.activities) {
			expect(activity.basePoints).toBeGreaterThan(0);
			expect(Number.isInteger(activity.basePoints)).toBe(true);
		}
	});

	it('全活動に name がある', () => {
		const pack = getActivityPack(packId);
		expect(pack).not.toBeNull();
		if (!pack) return;
		for (const activity of pack.activities) {
			expect(activity.name).not.toBe('');
		}
	});
});

describe('中学生チャレンジ (junior-high-challenge)', () => {
	it('対象年齢が10-14歳', () => {
		const pack = getActivityPack('junior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.targetAgeMin).toBe(10);
		expect(pack.targetAgeMax).toBe(14);
	});

	it('gradeLevel が middle_school', () => {
		const pack = getActivityPack('junior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		for (const activity of pack.activities) {
			expect(activity.gradeLevel).toBe('middle_school');
		}
	});

	it('5カテゴリをカバー', () => {
		const pack = getActivityPack('junior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		const categories = new Set(pack.activities.map((a) => a.categoryCode));
		expect(categories.size).toBe(5);
	});
});

describe('高校生チャレンジ (senior-high-challenge)', () => {
	it('対象年齢が15-18歳', () => {
		const pack = getActivityPack('senior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.targetAgeMin).toBe(15);
		expect(pack.targetAgeMax).toBe(18);
	});

	it('gradeLevel が high_school', () => {
		const pack = getActivityPack('senior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		for (const activity of pack.activities) {
			expect(activity.gradeLevel).toBe('high_school');
		}
	});

	it('5カテゴリをカバー', () => {
		const pack = getActivityPack('senior-high-challenge');
		expect(pack).not.toBeNull();
		if (!pack) return;
		const categories = new Set(pack.activities.map((a) => a.categoryCode));
		expect(categories.size).toBe(5);
	});
});

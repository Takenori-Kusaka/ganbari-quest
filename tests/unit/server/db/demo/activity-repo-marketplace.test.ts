// tests/unit/server/db/demo/activity-repo-marketplace.test.ts
// #2097 Phase B-7: demo Lambda activity-repo の marketplace integration を検証する。
// per-child default pack 仕様 (docs/research/2097-marketplace-default-import-spec.md §3) の充足を assert。

import { describe, expect, it } from 'vitest';
import * as activityRepo from '../../../../../src/lib/server/db/demo/activity-repo';
import {
	DEMO_MARKETPLACE_ACTIVITIES,
	getDemoMarketplaceActivitiesByChild,
} from '../../../../../src/lib/server/demo/demo-data';

describe('demo/activity-repo — marketplace integration (#2097 B-7)', () => {
	describe('per-child marketplace pack', () => {
		it('902 (preschool F): kinder-starter から 30 件以上の activities を取得', () => {
			const activities = getDemoMarketplaceActivitiesByChild(902);
			expect(activities.length).toBeGreaterThanOrEqual(30);
			// preset 由来であること
			expect(activities.every((a) => a.sourcePresetId === 'kinder-starter')).toBe(true);
			// 既知の kinder-starter item（はみがきした）が含まれる
			expect(activities.some((a) => a.name === 'はみがきした')).toBe(true);
		});

		it('903 (elementary M): elementary-boy から 25 件以上', () => {
			const activities = getDemoMarketplaceActivitiesByChild(903);
			expect(activities.length).toBeGreaterThanOrEqual(25);
			expect(activities.every((a) => a.sourcePresetId === 'elementary-boy')).toBe(true);
		});

		it('904 (junior F): junior-girl から 20 件以上', () => {
			const activities = getDemoMarketplaceActivitiesByChild(904);
			expect(activities.length).toBeGreaterThanOrEqual(20);
			expect(activities.every((a) => a.sourcePresetId === 'junior-girl')).toBe(true);
		});

		it('906 (senior M): senior-boy から 20 件以上', () => {
			const activities = getDemoMarketplaceActivitiesByChild(906);
			expect(activities.length).toBeGreaterThanOrEqual(20);
			expect(activities.every((a) => a.sourcePresetId === 'senior-boy')).toBe(true);
		});

		it('901 (baby M): marketplace 対象外 — 空配列', () => {
			const activities = getDemoMarketplaceActivitiesByChild(901);
			expect(activities).toHaveLength(0);
		});
	});

	describe('synthetic ID 衝突回避', () => {
		it('全 marketplace activities は id >= 5000 (既存 DEMO_ACTIVITIES と衝突しない)', () => {
			expect(DEMO_MARKETPLACE_ACTIVITIES.every((a) => a.id >= 5000)).toBe(true);
		});

		it('全 marketplace activities の id は unique', () => {
			const ids = DEMO_MARKETPLACE_ACTIVITIES.map((a) => a.id);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});

	describe('findActivities (Repository read)', () => {
		it('全 activities 一覧に marketplace 由来が含まれる (hand-curated + marketplace マージ)', async () => {
			const all = await activityRepo.findActivities('demo');
			// 既存 DEMO_ACTIVITIES (~53) + marketplace (~100+) → 150+ 件期待
			expect(all.length).toBeGreaterThan(100);
			// marketplace 由来 (source: 'marketplace') が含まれる
			expect(all.some((a) => a.source === 'marketplace')).toBe(true);
		});

		it('childAge=5 で preschool レンジ の activities が大幅に増える (marketplace 取込後)', async () => {
			const filtered = await activityRepo.findActivities('demo', { childAge: 5 });
			// kinder-starter (30) + 既存 DEMO_ACTIVITIES の preschool レンジ → 30 件以上期待
			// 注: name 重複は DEMO_ACTIVITIES (source='pack') 優先で dedup されるため、
			// sourcePresetId フィルタではなく総数で検証する
			expect(filtered.length).toBeGreaterThanOrEqual(30);
		});
	});

	describe('Activity schema 整合性', () => {
		it('marketplace activities は priority="must" / "optional" のいずれか', () => {
			expect(
				DEMO_MARKETPLACE_ACTIVITIES.every(
					(a) => a.priority === 'must' || a.priority === 'optional',
				),
			).toBe(true);
		});

		it('marketplace activities は categoryId 1-5 (CATEGORY_CODES 範囲内)', () => {
			expect(DEMO_MARKETPLACE_ACTIVITIES.every((a) => a.categoryId >= 1 && a.categoryId <= 5)).toBe(
				true,
			);
		});
	});
});

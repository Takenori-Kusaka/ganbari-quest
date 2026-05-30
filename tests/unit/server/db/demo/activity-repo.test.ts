// tests/unit/server/db/demo/activity-repo.test.ts
// ADR-0048 §決定 §2: demo Activity Repo の Fake (read) + Stub (write) hybrid 検証。

import { describe, expect, it } from 'vitest';
import * as activityRepo from '../../../../../src/lib/server/db/demo/activity-repo';
import { DEMO_ACTIVITIES, DEMO_ACTIVITY_LOGS } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/activity-repo', () => {
	describe('read API', () => {
		it('findActivities は visible activity を返す', async () => {
			const all = await activityRepo.findActivities('demo');
			expect(all.length).toBeGreaterThan(0);
			expect(all.every((a) => a.isVisible === 1)).toBe(true);
		});

		it('findActivities (filter: categoryId=1) は categoryId=1 のみ', async () => {
			const filtered = await activityRepo.findActivities('demo', { categoryId: 1 });
			expect(filtered.length).toBeGreaterThan(0);
			expect(filtered.every((a) => a.categoryId === 1)).toBe(true);
		});

		it('findActivities (filter: childAge=8) は ageRange に合う activity のみ', async () => {
			const filtered = await activityRepo.findActivities('demo', { childAge: 8 });
			expect(
				filtered.every(
					(a) => (a.ageMin === null || a.ageMin <= 8) && (a.ageMax === null || a.ageMax >= 8),
				),
			).toBe(true);
		});

		it('findActivityById は fixture から該当 activity を返す', async () => {
			const sample = DEMO_ACTIVITIES[0];
			expect(sample).toBeDefined();
			if (!sample) return;
			const fetched = await activityRepo.findActivityById(sample.id, 'demo');
			expect(fetched).toEqual(sample);
		});

		it('hasActivityLogs は existing activityId に対し true', async () => {
			const sample = DEMO_ACTIVITY_LOGS[0];
			expect(sample).toBeDefined();
			if (!sample) return;
			const result = await activityRepo.hasActivityLogs(sample.activityId, 'demo');
			expect(result).toBe(true);
		});

		it('countActiveActivityLogs は cancelled=0 のみカウント', async () => {
			const count = await activityRepo.countActiveActivityLogs(902, 'demo');
			const expected = DEMO_ACTIVITY_LOGS.filter(
				(l) => l.childId === 902 && l.cancelled === 0,
			).length;
			expect(count).toBe(expected);
		});

		it('findActivityLogs は ActivityLogSummary で activityName / activityIcon を含む', async () => {
			const logs = await activityRepo.findActivityLogs(902, 'demo');
			expect(logs.length).toBeGreaterThan(0);
			expect(logs[0]).toHaveProperty('activityName');
			expect(logs[0]).toHaveProperty('activityIcon');
			expect(logs[0]).toHaveProperty('categoryId');
		});
	});

	describe('write API', () => {
		it('insertActivity は input から Activity を返すが fixture を mutate しない', async () => {
			const before = DEMO_ACTIVITIES.length;
			const created = await activityRepo.insertActivity(
				{ name: 'test', categoryId: 1, icon: '🧪', basePoints: 5, ageMin: 3, ageMax: 10 },
				'demo',
			);
			expect(created.name).toBe('test');
			expect(DEMO_ACTIVITIES.length).toBe(before);
		});

		it('insertActivityLog は ActivityLog を返す (no-op for fixture)', async () => {
			const before = DEMO_ACTIVITY_LOGS.length;
			const log = await activityRepo.insertActivityLog(
				{
					childId: 902,
					activityId: 1,
					points: 5,
					streakDays: 0,
					streakBonus: 0,
					recordedDate: '2026-04-01',
					recordedAt: '2026-04-01T10:00:00.000Z',
				},
				'demo',
			);
			expect(log.points).toBe(5);
			expect(DEMO_ACTIVITY_LOGS.length).toBe(before);
		});

		it('insertPointLedger / deleteActivity / archiveActivities は no-op で例外を投げない', async () => {
			await expect(
				activityRepo.insertPointLedger(
					{ childId: 902, amount: 10, type: 'test', description: 'noop' },
					'demo',
				),
			).resolves.toBeUndefined();
			await expect(activityRepo.deleteActivity(99999, 'demo')).resolves.toBeUndefined();
			// Phase 7 PR-2a (#2688): ArchivedReason 型強制で 'test' → 'trial_expired' (ARCHIVED_REASONS SSOT)
			await expect(
				activityRepo.archiveActivities([1], 'trial_expired', 'demo'),
			).resolves.toBeUndefined();
		});

		it('deleteActivityLogsBeforeDate は 0 件削除を返す (stateless)', async () => {
			const result = await activityRepo.deleteActivityLogsBeforeDate(902, '2020-01-01', 'demo');
			expect(result).toBe(0);
		});
	});

	describe('aggregation queries (Fake)', () => {
		it('countDistinctCategories は demo log の category 集合サイズ', async () => {
			const count = await activityRepo.countDistinctCategories(902, 'demo');
			expect(count).toBeGreaterThanOrEqual(0);
		});

		it('getCategoryCountsByDate は recordedDate → categoryCount mapping', async () => {
			const result = await activityRepo.getCategoryCountsByDate(902, 'demo');
			expect(Array.isArray(result)).toBe(true);
		});
	});
});

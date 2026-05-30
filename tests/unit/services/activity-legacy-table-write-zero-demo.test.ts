// tests/unit/services/activity-legacy-table-write-zero-demo.test.ts
//
// #2458-A2 regression test (demo backend): demo activity-repo の全 write method を
// 呼んでも DEMO_CHILD_ACTIVITIES / DEMO_ACTIVITIES / DEMO_MARKETPLACE_ACTIVITIES /
// DEMO_ACTIVITY_LOGS (旧 master fixture) の長さが不変であることを保証する。
//
// demo Lambda (ADR-0048) では DB write が物理的に発生しないが、in-memory mutation
// すら無いことを assert することで「将来 mutation を加えた瞬間に CI が落ちる」
// 構造的ガードを設置する。
//
// PR-A2 設計判断: demo backend の read 経路は旧 master fixture
// (ALL_DEMO_ACTIVITIES = DEMO_ACTIVITIES + DEMO_MARKETPLACE_ACTIVITIES merged) を
// primary source として保持 (marketplace integration テスト #2097 Phase B-7 を
// 退行させない)。per-child scope queries は demo/child-activity-repo.ts 経由で
// `DEMO_CHILD_ACTIVITIES` から取得される設計のため、本 file は write 0 件のみを
// assert する責務に限定。
//
// 関連:
//   - PR #2487 (#2458-A1 sqlite facade rewrite、reference pattern)
//   - ADR-0055 §3.1 per-child primary data model
//   - ADR-0048 demo Lambda stateless 原則

import { describe, expect, it } from 'vitest';
import * as demoActivityRepo from '$lib/server/db/demo/activity-repo';
import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_CHILD_ACTIVITIES,
	DEMO_MARKETPLACE_ACTIVITIES,
} from '$lib/server/demo/demo-data';

const TENANT = 't-demo-2458-write-zero';

describe('#2458-A2 demo: 旧 fixture mutation 0 件保証', () => {
	it('insertActivity: 全 fixture の長さ不変 (synthetic 戻り値 id=0)', async () => {
		const beforeChildActivities = DEMO_CHILD_ACTIVITIES.length;
		const beforeMaster = DEMO_ACTIVITIES.length;
		const beforeMarketplace = DEMO_MARKETPLACE_ACTIVITIES.length;
		const beforeLogs = DEMO_ACTIVITY_LOGS.length;

		const result = await demoActivityRepo.insertActivity(
			{
				name: 'たいそうした',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
				priority: 'optional',
			},
			TENANT,
		);

		expect(result).toBeDefined();
		expect(result.name).toBe('たいそうした');
		expect(result.id).toBe(0); // Stub: synthetic id (no actual insert)
		// AC: 全 fixture が mutate されていない
		expect(DEMO_CHILD_ACTIVITIES.length).toBe(beforeChildActivities);
		expect(DEMO_ACTIVITIES.length).toBe(beforeMaster);
		expect(DEMO_MARKETPLACE_ACTIVITIES.length).toBe(beforeMarketplace);
		expect(DEMO_ACTIVITY_LOGS.length).toBe(beforeLogs);
	});

	it('updateActivity: 全 fixture 不変 + 戻り値の name が元 fixture と一致', async () => {
		const beforeMasterLen = DEMO_ACTIVITIES.length;
		const target = DEMO_ACTIVITIES[0];
		if (!target) throw new Error('DEMO_ACTIVITIES empty');
		const originalName = target.name;

		const updated = await demoActivityRepo.updateActivity(
			target.id,
			{ name: '更新後', basePoints: 999 },
			TENANT,
		);

		// Stub: 元 fixture を find して返すのみ (mutation なし)
		expect(updated).toBeDefined();
		expect(updated?.name).toBe(originalName); // 更新後ではない (mutation なし)
		expect(DEMO_ACTIVITIES.length).toBe(beforeMasterLen);
		expect(target.name).toBe(originalName); // 元 fixture の name 不変
	});

	it('setActivityVisibility: 元 fixture の isVisible 不変', async () => {
		const target = DEMO_ACTIVITIES[0];
		if (!target) throw new Error('DEMO_ACTIVITIES empty');
		const originalVisibility = target.isVisible;

		const result = await demoActivityRepo.setActivityVisibility(target.id, false, TENANT);

		expect(result).toBeDefined();
		// Stub: 元 fixture の visibility が不変
		expect(target.isVisible).toBe(originalVisibility);
	});

	it('deleteActivity: 元 fixture から削除されない', async () => {
		const beforeMasterIds = DEMO_ACTIVITIES.map((a) => a.id);
		const targetId = DEMO_ACTIVITIES[0]?.id ?? 1;

		const result = await demoActivityRepo.deleteActivity(targetId, TENANT);

		expect(result).toBeDefined();
		// Stub: fixture から削除されていない
		expect(DEMO_ACTIVITIES.map((a) => a.id)).toEqual(beforeMasterIds);
	});

	it('archiveActivities + restoreArchivedActivities: 全 fixture 不変', async () => {
		const beforeMasterArchive = DEMO_ACTIVITIES.map((a) => a.isArchived);
		const beforeMarketplaceArchive = DEMO_MARKETPLACE_ACTIVITIES.map((a) => a.isArchived);
		const beforeChildArchive = DEMO_CHILD_ACTIVITIES.map((a) => a.isArchived);
		const targetIds = DEMO_ACTIVITIES.slice(0, 2).map((a) => a.id);

		// Phase 7 PR-2a (#2688): ArchivedReason 型強制 (ARCHIVED_REASONS SSOT)
		await demoActivityRepo.archiveActivities(targetIds, 'trial_expired', TENANT);
		// Stub no-op: archive flag が mutate されていない
		expect(DEMO_ACTIVITIES.map((a) => a.isArchived)).toEqual(beforeMasterArchive);
		expect(DEMO_MARKETPLACE_ACTIVITIES.map((a) => a.isArchived)).toEqual(beforeMarketplaceArchive);
		expect(DEMO_CHILD_ACTIVITIES.map((a) => a.isArchived)).toEqual(beforeChildArchive);

		await demoActivityRepo.restoreArchivedActivities('trial_expired', TENANT);
		expect(DEMO_ACTIVITIES.map((a) => a.isArchived)).toEqual(beforeMasterArchive);
		expect(DEMO_MARKETPLACE_ACTIVITIES.map((a) => a.isArchived)).toEqual(beforeMarketplaceArchive);
		expect(DEMO_CHILD_ACTIVITIES.map((a) => a.isArchived)).toEqual(beforeChildArchive);
	});

	it('insertActivityLog: DEMO_ACTIVITY_LOGS 不変', async () => {
		const beforeLogs = DEMO_ACTIVITY_LOGS.length;

		const result = await demoActivityRepo.insertActivityLog(
			{
				childId: 902,
				activityId: 9020001,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-05-26',
				recordedAt: '2026-05-26T10:00:00Z',
			},
			TENANT,
		);

		expect(result).toBeDefined();
		expect(result.childId).toBe(902);
		expect(result.id).toBe(0); // Stub: synthetic id
		// AC: DEMO_ACTIVITY_LOGS の長さ不変
		expect(DEMO_ACTIVITY_LOGS.length).toBe(beforeLogs);
	});

	it('markActivityLogCancelled: DEMO_ACTIVITY_LOGS の cancelled flag 不変', async () => {
		const target = DEMO_ACTIVITY_LOGS[0];
		if (!target) throw new Error('DEMO_ACTIVITY_LOGS empty');
		const originalCancelled = target.cancelled;

		await demoActivityRepo.markActivityLogCancelled(target.id, TENANT);

		// Stub no-op: cancelled flag mutate されない
		expect(target.cancelled).toBe(originalCancelled);
	});

	it('insertPointLedger: fixture 不変 (no-op)', async () => {
		const beforeMasterLen = DEMO_ACTIVITIES.length;
		const beforeLogsLen = DEMO_ACTIVITY_LOGS.length;

		await demoActivityRepo.insertPointLedger(
			{
				childId: 902,
				amount: 100,
				type: 'combo_bonus',
				description: 'test',
			},
			TENANT,
		);

		// no-op: 何も発生しない
		expect(DEMO_ACTIVITIES.length).toBe(beforeMasterLen);
		expect(DEMO_ACTIVITY_LOGS.length).toBe(beforeLogsLen);
	});

	it('deleteDailyMissionsByActivity: no-op + fixture 不変', async () => {
		const beforeMasterLen = DEMO_ACTIVITIES.length;
		const beforeLogsLen = DEMO_ACTIVITY_LOGS.length;

		await demoActivityRepo.deleteDailyMissionsByActivity(123, TENANT);

		expect(DEMO_ACTIVITIES.length).toBe(beforeMasterLen);
		expect(DEMO_ACTIVITY_LOGS.length).toBe(beforeLogsLen);
	});

	it('deleteActivityLogsBeforeDate: 0 を返す + fixture 不変', async () => {
		const beforeLogsLen = DEMO_ACTIVITY_LOGS.length;

		const deletedCount = await demoActivityRepo.deleteActivityLogsBeforeDate(
			902,
			'2026-01-01',
			TENANT,
		);

		expect(deletedCount).toBe(0); // Stub: 削除しない
		expect(DEMO_ACTIVITY_LOGS.length).toBe(beforeLogsLen);
	});
});

describe('#2458-A2 demo: read 経路は引き続き ALL_DEMO_ACTIVITIES (marketplace integration 維持)', () => {
	it('findActivities: marketplace 由来を含む (master + marketplace merged)', async () => {
		const list = await demoActivityRepo.findActivities(TENANT);

		// 既存 #2097 Phase B-7 の挙動: marketplace 由来 (source='marketplace') が含まれる
		expect(list.length).toBeGreaterThan(0);
		expect(list.some((a) => a.source === 'marketplace')).toBe(true);
	});

	it('findActivityById: ALL_DEMO_ACTIVITIES を find', async () => {
		const target = DEMO_ACTIVITIES[0];
		if (!target) throw new Error('DEMO_ACTIVITIES empty');

		const result = await demoActivityRepo.findActivityById(target.id, TENANT);

		expect(result).toBeDefined();
		expect(result?.id).toBe(target.id);
		expect(result?.name).toBe(target.name);
	});
});

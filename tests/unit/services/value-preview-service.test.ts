// tests/unit/services/value-preview-service.test.ts
// #1600 ADR-0023 I9 — 初月価値プレビューサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	getTenantValuePreview,
	MILESTONES,
} from '../../../src/lib/server/services/value-preview-service';

const TENANT = 'tenant-1600';

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

function seed(opts: { childCreatedAt: string }): { childId: number } {
	resetDb(sqlite);
	const child = testDb
		.insert(schema.children)
		.values({
			nickname: 'プレビュー子',
			age: 6,
			theme: 'blue',
			createdAt: opts.childCreatedAt,
		})
		.returning()
		.get();
	testDb
		.insert(schema.activities)
		.values({
			name: 'たいそう',
			categoryId: 1,
			icon: '🤸',
			basePoints: 5,
		})
		.run();
	testDb
		.insert(schema.activities)
		.values({
			name: 'えほん',
			categoryId: 2,
			icon: '📖',
			basePoints: 5,
		})
		.run();
	return { childId: child.id };
}

function logActivity(
	childId: number,
	activityId: number,
	recordedDate: string,
	points = 5,
	streakBonus = 0,
) {
	testDb
		.insert(schema.activityLogs)
		.values({
			childId,
			activityId,
			points,
			streakDays: 1,
			streakBonus,
			recordedDate,
			recordedAt: `${recordedDate}T10:00:00.000Z`,
		})
		.run();
}

describe('getTenantValuePreview - 子供未登録', () => {
	beforeEach(() => {
		resetDb(sqlite);
	});

	it('子供 0 件のテナントは空のプレビューを返す', async () => {
		const preview = await getTenantValuePreview(TENANT);
		expect(preview.children).toHaveLength(0);
		expect(preview.tenantSignupDate).toBeNull();
		expect(preview.daysSinceTenantSignup).toBeNull();
		expect(preview.isInFirstMonth).toBe(false);
		expect(preview.previewEligible).toBe(false);
	});
});

describe('getTenantValuePreview - 初月期間判定', () => {
	it('signup 5 日後は isInFirstMonth=true / previewEligible=true', async () => {
		const today = new Date().toISOString().slice(0, 10);
		const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		seed({ childCreatedAt: `${fiveDaysAgo}T10:00:00.000Z` });

		const preview = await getTenantValuePreview(TENANT);
		expect(preview.tenantSignupDate).toBe(fiveDaysAgo);
		expect(preview.daysSinceTenantSignup).toBe(5);
		expect(preview.isInFirstMonth).toBe(true);
		expect(preview.previewEligible).toBe(true);
		// 確認: today が定数のため 0 ではない
		expect(today.length).toBe(10);
	});

	it('signup 60 日後は isInFirstMonth=false / previewEligible=true', async () => {
		const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		seed({ childCreatedAt: `${sixtyDaysAgo}T10:00:00.000Z` });

		const preview = await getTenantValuePreview(TENANT);
		expect(preview.daysSinceTenantSignup).toBe(60);
		expect(preview.isInFirstMonth).toBe(false);
		expect(preview.previewEligible).toBe(true);
	});

	it('signup 当日 (0 日経過) は previewEligible=false', async () => {
		const today = new Date().toISOString().slice(0, 10);
		seed({ childCreatedAt: `${today}T00:00:00.000Z` });

		const preview = await getTenantValuePreview(TENANT);
		expect(preview.daysSinceTenantSignup).toBe(0);
		expect(preview.isInFirstMonth).toBe(true);
		expect(preview.previewEligible).toBe(false);
	});
});

describe('getTenantValuePreview - マイルストーン判定', () => {
	it('活動記録 0 件は全マイルストーン未達成', async () => {
		const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		seed({ childCreatedAt: `${fiveDaysAgo}T10:00:00.000Z` });

		const preview = await getTenantValuePreview(TENANT);
		const child = preview.children[0];
		expect(child).toBeDefined();
		expect(child?.totalActivities).toBe(0);
		expect(child?.milestones.every((m) => !m.achieved)).toBe(true);
	});

	it('活動 1 件で first_record マイルストーン達成', async () => {
		const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		const { childId } = seed({ childCreatedAt: `${fiveDaysAgo}T10:00:00.000Z` });
		logActivity(childId, 1, fiveDaysAgo);

		const preview = await getTenantValuePreview(TENANT);
		const child = preview.children[0];
		expect(child?.totalActivities).toBe(1);
		const firstRecord = child?.milestones.find((m) => m.id === 'first_record');
		expect(firstRecord?.achieved).toBe(true);
		expect(firstRecord?.achievedAt).toBe(fiveDaysAgo);

		// 5 件マイルストーンは未達成
		const r5 = child?.milestones.find((m) => m.id === 'records_5');
		expect(r5?.achieved).toBe(false);
	});

	it('活動 5 件で records_5 マイルストーン達成', async () => {
		const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		const { childId } = seed({ childCreatedAt: `${tenDaysAgo}T10:00:00.000Z` });
		// 5 日分 × 1 活動 = 5 件
		for (let i = 0; i < 5; i++) {
			const date = new Date(Date.now() - (10 - i) * 24 * 3600 * 1000).toISOString().slice(0, 10);
			logActivity(childId, 1, date);
		}

		const preview = await getTenantValuePreview(TENANT);
		const child = preview.children[0];
		expect(child?.totalActivities).toBe(5);
		const r5 = child?.milestones.find((m) => m.id === 'records_5');
		expect(r5?.achieved).toBe(true);
	});

	it('7 日連続記録で streak_7 マイルストーン達成（longest streak で判定）', async () => {
		const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		const { childId } = seed({ childCreatedAt: `${fifteenDaysAgo}T10:00:00.000Z` });
		// 7 連続日記録
		for (let i = 0; i < 7; i++) {
			const date = new Date(Date.now() - (15 - i) * 24 * 3600 * 1000).toISOString().slice(0, 10);
			logActivity(childId, 1, date);
		}

		const preview = await getTenantValuePreview(TENANT);
		const child = preview.children[0];
		expect(child?.longestStreak).toBe(7);
		const s7 = child?.milestones.find((m) => m.id === 'streak_7');
		expect(s7?.achieved).toBe(true);
		const s14 = child?.milestones.find((m) => m.id === 'streak_14');
		expect(s14?.achieved).toBe(false);
	});
});

describe('getTenantValuePreview - カテゴリ別集計', () => {
	it('複数カテゴリの記録が categoryBreakdown に件数降順で並ぶ', async () => {
		const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		const { childId } = seed({ childCreatedAt: `${tenDaysAgo}T10:00:00.000Z` });

		// カテゴリ1 (activityId=1): 3 件、カテゴリ2 (activityId=2): 1 件
		for (let i = 0; i < 3; i++) {
			const date = new Date(Date.now() - (10 - i) * 24 * 3600 * 1000).toISOString().slice(0, 10);
			logActivity(childId, 1, date);
		}
		const recentDate = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		logActivity(childId, 2, recentDate);

		const preview = await getTenantValuePreview(TENANT);
		const child = preview.children[0];
		expect(child?.categoryBreakdown).toHaveLength(2);
		expect(child?.categoryBreakdown[0]?.categoryId).toBe(1);
		expect(child?.categoryBreakdown[0]?.count).toBe(3);
		expect(child?.categoryBreakdown[1]?.categoryId).toBe(2);
		expect(child?.categoryBreakdown[1]?.count).toBe(1);
	});
});

describe('MILESTONES 定義', () => {
	it('6 件のマイルストーンが定義されている', () => {
		expect(MILESTONES).toHaveLength(6);
	});

	it('count 系と streak 系の両方を含む', () => {
		const counts = MILESTONES.filter((m) => m.kind === 'count');
		const streaks = MILESTONES.filter((m) => m.kind === 'streak');
		expect(counts.length).toBeGreaterThan(0);
		expect(streaks.length).toBeGreaterThan(0);
	});

	it('閾値が単調増加で重複しない（kind 別に）', () => {
		const counts = MILESTONES.filter((m) => m.kind === 'count').map((m) => m.threshold);
		const sortedCounts = [...counts].sort((a, b) => a - b);
		expect(counts).toEqual(sortedCounts);
		expect(new Set(counts).size).toBe(counts.length);

		const streaks = MILESTONES.filter((m) => m.kind === 'streak').map((m) => m.threshold);
		const sortedStreaks = [...streaks].sort((a, b) => a - b);
		expect(streaks).toEqual(sortedStreaks);
		expect(new Set(streaks).size).toBe(streaks.length);
	});
});

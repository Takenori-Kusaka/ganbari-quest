// tests/unit/services/achievement-service.test.ts
// 実績サービスのユニットテスト（マイルストーン型対応）

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	type TestDb,
	type TestSqlite,
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
} from '../helpers/test-db';

// ---- テスト用インメモリ DB ----
let sqlite: TestSqlite;
let testDb: TestDb;

// vi.mock で db モジュールを差し替え
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

import {
	checkAndUnlockAchievements,
	getChildAchievements,
} from '../../../src/lib/server/services/achievement-service';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

function seedBase() {
	resetDb();

	// 子供
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();

	// 活動マスタ（5カテゴリ分）
	const acts = [
		{ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'えほん', categoryId: 2, icon: '📖', basePoints: 5, sortOrder: 2 },
		{ name: 'おえかき', categoryId: 5, icon: '🎨', basePoints: 5, sortOrder: 3 },
		{ name: 'はみがき', categoryId: 3, icon: '🪥', basePoints: 3, sortOrder: 4 },
		{ name: 'あいさつ', categoryId: 4, icon: '👋', basePoints: 3, sortOrder: 5 },
	];
	for (const a of acts) {
		testDb.insert(schema.activities).values(a).run();
	}

	// ベンチマーク
	const benchmarks = [
		{ age: 4, categoryId: 1, mean: 30.0, stdDev: 10.0 },
		{ age: 4, categoryId: 2, mean: 20.0, stdDev: 8.0 },
		{ age: 4, categoryId: 5, mean: 25.0, stdDev: 9.0 },
		{ age: 4, categoryId: 3, mean: 35.0, stdDev: 8.0 },
		{ age: 4, categoryId: 4, mean: 25.0, stdDev: 10.0 },
	];
	for (const b of benchmarks) {
		testDb.insert(schema.marketBenchmarks).values(b).run();
	}

	// ステータス初期値
	const statuses = [
		{ childId: 1, categoryId: 1, totalXp: 30, level: 2, peakXp: 30 },
		{ childId: 1, categoryId: 2, totalXp: 20, level: 2, peakXp: 20 },
		{ childId: 1, categoryId: 5, totalXp: 25, level: 2, peakXp: 25 },
		{ childId: 1, categoryId: 3, totalXp: 35, level: 2, peakXp: 35 },
		{ childId: 1, categoryId: 4, totalXp: 25, level: 2, peakXp: 25 },
	];
	for (const s of statuses) {
		testDb.insert(schema.statuses).values(s).run();
	}
}

function seedAchievements() {
	testDb
		.insert(schema.achievements)
		.values([
			{
				code: 'first_step',
				name: 'はじめのいっぽ',
				icon: '🌟',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			},
			{
				code: 'streak_master',
				name: 'れんぞくチャレンジ',
				icon: '🔥',
				conditionType: 'streak_days',
				conditionValue: 3,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 2,
				repeatable: 1,
				milestoneValues: JSON.stringify([3, 5, 7]),
			},
			{
				code: 'activity_master',
				name: 'かつどうマスター',
				icon: '📝',
				conditionType: 'total_activities',
				conditionValue: 10,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 3,
				repeatable: 1,
				milestoneValues: JSON.stringify([10, 30, 50]),
			},
			{
				code: 'category_scout',
				name: 'カテゴリたんけんか',
				icon: '🧭',
				conditionType: 'category_complete',
				conditionValue: 2,
				bonusPoints: 15,
				rarity: 'common',
				sortOrder: 4,
				repeatable: 1,
				milestoneValues: JSON.stringify([2, 3, 5]),
			},
			{
				code: 'category_explorer',
				name: 'カテゴリたんけん',
				icon: '🌈',
				conditionType: 'all_categories',
				conditionValue: 1,
				bonusPoints: 50,
				rarity: 'rare',
				sortOrder: 5,
				repeatable: 0,
			},
			{
				code: 'point_collector',
				name: 'ポイントコレクター',
				icon: '💰',
				conditionType: 'total_points',
				conditionValue: 100,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 5,
				repeatable: 1,
				milestoneValues: JSON.stringify([100, 500]),
			},
			{
				code: 'kindergarten_grad',
				name: 'ほいくえんそつえん',
				icon: '🎓',
				conditionType: 'milestone_event',
				conditionValue: 0,
				bonusPoints: 500,
				rarity: 'legendary',
				sortOrder: 100,
				repeatable: 0,
				isMilestone: 1,
			},
		])
		.run();
}

describe('checkAndUnlockAchievements', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('初回活動で first_step を解除する', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-02-25',
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');

		expect(unlocked.length).toBeGreaterThanOrEqual(1);
		const firstStep = unlocked.find((a) => a.code === 'first_step');
		expect(firstStep).toBeDefined();
		expect(firstStep?.bonusPoints).toBe(10);
		expect(firstStep?.milestoneValue).toBeNull();
	});

	it('解除時にポイント台帳に achievement エントリが追加される', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		await checkAndUnlockAchievements(1, 'test-tenant');

		const ledger = testDb.select().from(schema.pointLedger).all();
		const achievementEntries = ledger.filter((e) => e.type === 'achievement');
		expect(achievementEntries.length).toBeGreaterThanOrEqual(1);
		expect(achievementEntries[0]?.amount).toBe(10);
	});

	it('既に解除済みの一度きり実績は重複解除しない', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		const first = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(first.map((a) => a.code)).toContain('first_step');

		const second = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(second.map((a) => a.code)).not.toContain('first_step');
	});

	it('条件未達成なら解除しない', async () => {
		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(unlocked).toHaveLength(0);
	});

	it('3日連続で streak_master のマイルストーン3を解除する', async () => {
		const dates = ['2026-02-23', '2026-02-24', '2026-02-25'];
		for (const date of dates) {
			testDb
				.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: 1,
					points: 5,
					recordedDate: date,
				})
				.run();
		}

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const streak = unlocked.find((a) => a.code === 'streak_master');
		expect(streak).toBeDefined();
		expect(streak?.milestoneValue).toBe(3);
		expect(streak?.bonusPoints).toBe(10); // base * (index 0 + 1)
	});

	it('全カテゴリ記録で category_explorer を解除する', async () => {
		for (let i = 1; i <= 5; i++) {
			testDb
				.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: i,
					points: 5,
					recordedDate: '2026-02-25',
				})
				.run();
		}

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const allCat = unlocked.find((a) => a.code === 'category_explorer');
		expect(allCat).toBeDefined();
		expect(allCat?.bonusPoints).toBe(50);
	});

	it('累計ポイントで point_collector マイルストーン100を解除する', async () => {
		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: 100, type: 'activity', description: 'テスト' })
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const points = unlocked.find((a) => a.code === 'point_collector');
		expect(points).toBeDefined();
		expect(points?.milestoneValue).toBe(100);
		expect(points?.bonusPoints).toBe(10); // base * 1
	});

	it('ライフイベント（milestone_event）は自動解除されない', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const lifeEvent = unlocked.find((a) => a.code === 'kindergarten_grad');
		expect(lifeEvent).toBeUndefined();
	});

	it('繰り返し実績は次のマイルストーンも解除できる', async () => {
		// 5日連続分の活動記録
		const dates = ['2026-02-21', '2026-02-22', '2026-02-23', '2026-02-24', '2026-02-25'];
		for (const date of dates) {
			testDb
				.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: 1,
					points: 5,
					recordedDate: date,
				})
				.run();
		}

		// 1回目: milestone 3 と 5 を解除
		const first = await checkAndUnlockAchievements(1, 'test-tenant');
		const streakUnlocks = first.filter((a) => a.code === 'streak_master');
		expect(streakUnlocks.length).toBe(2);
		expect(streakUnlocks.map((a) => a.milestoneValue).sort()).toEqual([3, 5]);

		// 2回目: 重複しない
		const second = await checkAndUnlockAchievements(1, 'test-tenant');
		const streakSecond = second.filter((a) => a.code === 'streak_master');
		expect(streakSecond).toHaveLength(0);
	});
});

describe('getChildAchievements', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('全実績一覧を返す', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		expect(achievements).toHaveLength(7);
	});

	it('未解除の実績は unlockedAt が null', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		expect(achievements.every((a) => a.unlockedAt === null)).toBe(true);
	});

	it('解除済みの一度きり実績には unlockedAt が設定される', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-25',
			})
			.run();
		await checkAndUnlockAchievements(1, 'test-tenant');

		const achievements = await getChildAchievements(1, 'test-tenant');
		const firstStep = achievements.find((a) => a.code === 'first_step');
		expect(firstStep?.unlockedAt).not.toBeNull();

		// 未解除の繰り返し実績（マイルストーン未到達分）
		const activityMaster = achievements.find((a) => a.code === 'activity_master');
		expect(activityMaster?.unlockedAt).toBeNull();
	});

	it('sortOrder 順に並ぶ', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		for (let i = 1; i < achievements.length; i++) {
			const current = achievements[i];
			const prev = achievements[i - 1];
			if (!current || !prev) throw new Error(`Expected achievements at indices ${i} and ${i - 1}`);
			expect(current.sortOrder).toBeGreaterThanOrEqual(prev.sortOrder);
		}
	});

	it('繰り返し実績にはマイルストーン情報が含まれる', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.code === 'streak_master');
		expect(streak?.repeatable).toBe(true);
		expect(streak?.milestones).toHaveLength(3); // [3,5,7]
		expect(streak?.milestones[0]?.value).toBe(3);
		expect(streak?.milestones[0]?.unlocked).toBe(false);
		expect(streak?.nextMilestone).toBe(3);
	});

	it('マイルストーン解除後は次のマイルストーンが表示される', async () => {
		// 3日連続
		for (const d of ['2026-02-23', '2026-02-24', '2026-02-25']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}
		await checkAndUnlockAchievements(1, 'test-tenant');

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.code === 'streak_master');
		expect(streak?.highestUnlockedMilestone).toBe(3);
		expect(streak?.nextMilestone).toBe(5);
		expect(streak?.milestones[0]?.unlocked).toBe(true);
	});

	it('ライフイベントは isMilestone=true で返される', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		const grad = achievements.find((a) => a.code === 'kindergarten_grad');
		expect(grad?.isMilestone).toBe(true);
		expect(grad?.conditionType).toBe('milestone_event');
	});
});

describe('category_scout (カテゴリたんけんか)', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('2カテゴリの活動で category_scout M=2 を解除する', async () => {
		// うんどう + べんきょう の2カテゴリ
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
			})
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 2,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const scout = unlocked.find((a) => a.code === 'category_scout');
		expect(scout).toBeDefined();
		expect(scout?.milestoneValue).toBe(2);
	});

	it('1カテゴリのみでは category_scout は解除されない', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const scout = unlocked.find((a) => a.code === 'category_scout');
		expect(scout).toBeUndefined();
	});

	it('3カテゴリで M=2 と M=3 を同時解除する', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
			})
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 2,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
			})
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 3,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const scouts = unlocked.filter((a) => a.code === 'category_scout');
		expect(scouts).toHaveLength(2);
		expect(scouts.map((s) => s.milestoneValue).sort()).toEqual([2, 3]);
	});
});

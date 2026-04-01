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
	getAchievementSummary,
	getChildAchievements,
	grantLifeEvent,
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

// ================================================================
// grantLifeEvent
// ================================================================

describe('grantLifeEvent', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('存在しない実績IDでエラーを返す', async () => {
		const result = await grantLifeEvent(1, 9999, 'test-tenant');
		expect(result).toEqual({ error: 'ACHIEVEMENT_NOT_FOUND' });
	});

	it('ライフイベントでない実績はエラーを返す', async () => {
		// first_step は isMilestone=0 (conditionType='total_activities')
		const allAchievements = testDb.select().from(schema.achievements).all();
		const firstStep = allAchievements.find((a) => a.code === 'first_step');
		if (!firstStep) throw new Error('first_step not found in seed data');

		const result = await grantLifeEvent(1, firstStep.id, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_A_LIFE_EVENT' });
	});

	it('既に解除済みの場合はエラーを返す', async () => {
		const allAchievements = testDb.select().from(schema.achievements).all();
		const grad = allAchievements.find((a) => a.code === 'kindergarten_grad');
		if (!grad) throw new Error('kindergarten_grad not found in seed data');

		// 1回目: 成功
		const first = await grantLifeEvent(1, grad.id, 'test-tenant');
		expect(first).toHaveProperty('success', true);

		// 2回目: 重複エラー
		const second = await grantLifeEvent(1, grad.id, 'test-tenant');
		expect(second).toEqual({ error: 'ALREADY_UNLOCKED' });
	});

	it('正常付与でポイントが加算されsuccess=trueを返す', async () => {
		const allAchievements = testDb.select().from(schema.achievements).all();
		const grad = allAchievements.find((a) => a.code === 'kindergarten_grad');
		if (!grad) throw new Error('kindergarten_grad not found in seed data');

		const result = await grantLifeEvent(1, grad.id, 'test-tenant');
		expect(result).toEqual({ success: true, bonusPoints: 500 });

		// ポイント台帳にエントリが追加されている
		const ledger = testDb.select().from(schema.pointLedger).all();
		const achievementEntry = ledger.find(
			(e) => e.type === 'achievement' && e.referenceId === grad.id,
		);
		expect(achievementEntry).toBeDefined();
		expect(achievementEntry?.amount).toBe(500);
	});

	it('正常付与で child_achievements にレコードが作成される', async () => {
		const allAchievements = testDb.select().from(schema.achievements).all();
		const grad = allAchievements.find((a) => a.code === 'kindergarten_grad');
		if (!grad) throw new Error('kindergarten_grad not found in seed data');

		await grantLifeEvent(1, grad.id, 'test-tenant');

		const childAchievements = testDb.select().from(schema.childAchievements).all();
		const record = childAchievements.find((ca) => ca.achievementId === grad.id);
		expect(record).toBeDefined();
		expect(record?.childId).toBe(1);
		expect(record?.milestoneValue).toBeNull();
	});
});

// ================================================================
// getAchievementSummary
// ================================================================

describe('getAchievementSummary', () => {
	beforeEach(() => {
		seedBase();
	});

	it('実績マスタが0件のとき 0/0 を返す', async () => {
		const summary = await getAchievementSummary(1, 'test-tenant');
		expect(summary).toEqual({ unlockedCount: 0, totalCount: 0 });
	});

	it('全実績が未解除のとき unlockedCount=0 を返す', async () => {
		seedAchievements();
		const summary = await getAchievementSummary(1, 'test-tenant');
		expect(summary.unlockedCount).toBe(0);
		expect(summary.totalCount).toBe(7);
	});

	it('一部解除済みのとき正しいカウントを返す', async () => {
		seedAchievements();

		// 活動記録を追加して first_step を解除
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

		const summary = await getAchievementSummary(1, 'test-tenant');
		expect(summary.unlockedCount).toBeGreaterThanOrEqual(1);
		expect(summary.totalCount).toBe(7);
	});

	it('同一実績の複数マイルストーン解除でも実績IDベースでカウントする', async () => {
		seedAchievements();

		// 5日連続で streak_master の M=3, M=5 を同時解除
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
		await checkAndUnlockAchievements(1, 'test-tenant');

		const summary = await getAchievementSummary(1, 'test-tenant');
		// streak_master は2マイルストーン解除だが、実績IDとしては1個
		// first_step + activity_master(M=10未達のはず) + streak_master で少なくとも2個は解除
		expect(summary.unlockedCount).toBeGreaterThanOrEqual(2);
		expect(summary.totalCount).toBe(7);
	});
});

// ================================================================
// getCurrentStreakDays (間接テスト: getChildAchievements の liveStreak 経由)
// ================================================================

describe('getCurrentStreakDays（liveStreak 経由の間接テスト）', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('活動記録が空のとき liveStreak=0', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streak?.liveStreak).toBe(0);
	});

	it('今日のみ記録があるとき liveStreak=1', async () => {
		// todayDateJST() は new Date() + JST offset を使う
		// 2026-03-01T00:00:00Z => JST 2026-03-01T09:00:00 => '2026-03-01'
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));

		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-03-01',
			})
			.run();

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streakAchievement = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streakAchievement?.liveStreak).toBe(1);

		vi.useRealTimers();
	});

	it('連続が途切れている場合 liveStreak=0（最終記録が2日以上前）', async () => {
		// 今日を 2026-03-05 に設定
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-05T00:00:00Z'));

		// 3/1, 3/2 に記録があるが 3/5 が今日 => 2日以上離れている
		testDb
			.insert(schema.activityLogs)
			.values([
				{ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-01' },
				{ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-02' },
			])
			.run();

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streakAchievement = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streakAchievement?.liveStreak).toBe(0);

		vi.useRealTimers();
	});

	it('昨日まで連続で記録がある場合 liveStreak が連続日数を返す', async () => {
		// 今日を 2026-03-04 に設定
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-04T00:00:00Z'));

		// 3/1, 3/2, 3/3 に連続記録（昨日まで3日連続）
		for (const d of ['2026-03-01', '2026-03-02', '2026-03-03']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streakAchievement = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streakAchievement?.liveStreak).toBe(3);

		vi.useRealTimers();
	});
});

// ================================================================
// getMaxStreakDays (間接テスト: getChildAchievements の currentProgress 経由)
// ================================================================

describe('getMaxStreakDays（currentProgress 経由の間接テスト）', () => {
	beforeEach(() => {
		seedBase();
		seedAchievements();
	});

	it('活動記録が空のとき streak_days の currentProgress=0', async () => {
		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streak?.currentProgress).toBe(0);
	});

	it('1日だけの記録で currentProgress=1', async () => {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-03-01',
			})
			.run();

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streak?.currentProgress).toBe(1);
	});

	it('連続3日の記録で currentProgress=3', async () => {
		for (const d of ['2026-03-01', '2026-03-02', '2026-03-03']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streak?.currentProgress).toBe(3);
	});

	it('途切れがある場合は最大連続を返す', async () => {
		// 3/1-3/3 (3日連続) + 3/5-3/6 (2日連続) -> max = 3
		for (const d of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}

		const achievements = await getChildAchievements(1, 'test-tenant');
		const streak = achievements.find((a) => a.conditionType === 'streak_days');
		expect(streak?.currentProgress).toBe(3);
	});
});

// ================================================================
// getCategoryIdFromCode / getCategoryNameFromCode (間接テスト)
// ================================================================

describe('getCategoryIdFromCode / getCategoryNameFromCode（間接テスト）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('有効なカテゴリコードで category_activities 実績の進捗を取得できる', async () => {
		// category_activities タイプの実績を追加
		testDb
			.insert(schema.achievements)
			.values({
				code: 'undou_count',
				name: 'うんどうたいしょう',
				icon: '🏃',
				conditionType: 'category_activities',
				conditionValue: 5,
				category: 'undou',
				bonusPoints: 20,
				rarity: 'common',
				sortOrder: 10,
				repeatable: 0,
			})
			.run();

		// undou カテゴリの活動ログを2件追加
		testDb
			.insert(schema.activityLogs)
			.values([
				{ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-01' },
				{ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-02' },
			])
			.run();

		const achievements = await getChildAchievements(1, 'test-tenant');
		const undouAchievement = achievements.find((a) => a.code === 'undou_count');
		expect(undouAchievement?.currentProgress).toBe(2);
		// conditionLabel に getCategoryNameFromCode 結果が含まれる
		expect(undouAchievement?.conditionLabel).toContain('うんどう');
	});

	it('存在しないカテゴリコードでは category_activities の進捗が0', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'invalid_cat',
				name: 'ふめいカテゴリ',
				icon: '?',
				conditionType: 'category_activities',
				conditionValue: 5,
				category: 'nonexistent',
				bonusPoints: 20,
				rarity: 'common',
				sortOrder: 11,
				repeatable: 0,
			})
			.run();

		const achievements = await getChildAchievements(1, 'test-tenant');
		const invalidCat = achievements.find((a) => a.code === 'invalid_cat');
		expect(invalidCat?.currentProgress).toBe(0);
	});

	it('category=null のとき category_activities の進捗が0', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'null_cat',
				name: 'ヌルカテゴリ',
				icon: '?',
				conditionType: 'category_activities',
				conditionValue: 5,
				category: null,
				bonusPoints: 20,
				rarity: 'common',
				sortOrder: 12,
				repeatable: 0,
			})
			.run();

		const achievements = await getChildAchievements(1, 'test-tenant');
		const nullCat = achievements.find((a) => a.code === 'null_cat');
		expect(nullCat?.currentProgress).toBe(0);
	});
});

// ================================================================
// evaluateCondition (間接テスト: checkAndUnlockAchievements 経由)
// ================================================================

describe('evaluateCondition（条件タイプ別 間接テスト）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('total_activities: 活動数が条件値以上で解除', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'total_3',
				name: '3かいかつどう',
				icon: '📝',
				conditionType: 'total_activities',
				conditionValue: 3,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		// 2件では未達
		testDb
			.insert(schema.activityLogs)
			.values([
				{ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-01' },
				{ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-02' },
			])
			.run();

		const first = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(first.find((a) => a.code === 'total_3')).toBeUndefined();

		// 3件目で達成
		testDb
			.insert(schema.activityLogs)
			.values({ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-03' })
			.run();

		const second = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(second.find((a) => a.code === 'total_3')).toBeDefined();
	});

	it('total_points: ポイント残高が条件値以上で解除', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'points_50',
				name: '50ポイント',
				icon: '💰',
				conditionType: 'total_points',
				conditionValue: 50,
				bonusPoints: 5,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		// 残高49ポイント: 未達
		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: 49, type: 'activity', description: 'テスト' })
			.run();

		const first = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(first.find((a) => a.code === 'points_50')).toBeUndefined();

		// さらに1ポイント追加で50に
		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: 1, type: 'activity', description: 'テスト2' })
			.run();

		const second = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(second.find((a) => a.code === 'points_50')).toBeDefined();
	});

	it('category_activities: 指定カテゴリの活動数で解除', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'undou_3',
				name: 'うんどう3かい',
				icon: '🏃',
				conditionType: 'category_activities',
				conditionValue: 3,
				category: 'undou',
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		// undou(categoryId=1) の活動を3件追加
		for (const d of ['2026-03-01', '2026-03-02', '2026-03-03']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(unlocked.find((a) => a.code === 'undou_3')).toBeDefined();
	});

	it('category_activities: 無効なカテゴリコードでは解除されない', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'bad_cat_check',
				name: 'ふめいカテゴリチェック',
				icon: '?',
				conditionType: 'category_activities',
				conditionValue: 1,
				category: 'nonexistent',
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		testDb
			.insert(schema.activityLogs)
			.values({ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-01' })
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(unlocked.find((a) => a.code === 'bad_cat_check')).toBeUndefined();
	});

	it('first_combo: combo_bonus タイプのポイント台帳エントリで解除', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'first_combo_test',
				name: 'はじめてのコンボ',
				icon: '🔗',
				conditionType: 'first_combo',
				conditionValue: 1,
				bonusPoints: 15,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		// combo_bonus なし: 未達
		const first = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(first.find((a) => a.code === 'first_combo_test')).toBeUndefined();

		// combo_bonus 追加で達成
		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: 10, type: 'combo_bonus', description: 'コンボ' })
			.run();

		const second = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(second.find((a) => a.code === 'first_combo_test')).toBeDefined();
	});

	it('first_purchase: purchase タイプのポイント台帳エントリで解除', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'first_purchase_test',
				name: 'はじめてのおかいもの',
				icon: '🛒',
				conditionType: 'first_purchase',
				conditionValue: 1,
				bonusPoints: 15,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		testDb
			.insert(schema.pointLedger)
			.values({ childId: 1, amount: -50, type: 'purchase', description: 'おかいもの' })
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(unlocked.find((a) => a.code === 'first_purchase_test')).toBeDefined();
	});

	it('milestone_event: 自動チェックでは常に解除されない', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'life_event_test',
				name: 'テストイベント',
				icon: '🎓',
				conditionType: 'milestone_event',
				conditionValue: 0,
				bonusPoints: 100,
				rarity: 'legendary',
				sortOrder: 1,
				repeatable: 0,
				isMilestone: 1,
			})
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(unlocked.find((a) => a.code === 'life_event_test')).toBeUndefined();
	});

	it('不明な conditionType では解除されない', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'unknown_condition',
				name: 'ふめいじょうけん',
				icon: '?',
				conditionType: 'some_unknown_type',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 0,
			})
			.run();

		testDb
			.insert(schema.activityLogs)
			.values({ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-01' })
			.run();

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		expect(unlocked.find((a) => a.code === 'unknown_condition')).toBeUndefined();
	});
});

// ================================================================
// getMilestoneRarity (間接テスト: checkAndUnlockAchievements の rarity 経由)
// ================================================================

describe('getMilestoneRarity（rarity 経由の間接テスト）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('マイルストーン 10段階の各段階で正しいレアリティが返る', async () => {
		// 10段階のマイルストーンを設定: index/total の ratio で判定
		// index 0 => ratio 0.1 => common
		// index 2 => ratio 0.3 => rare
		// index 5 => ratio 0.6 => epic
		// index 8 => ratio 0.9 => legendary
		testDb
			.insert(schema.achievements)
			.values({
				code: 'rarity_test',
				name: 'レアリティテスト',
				icon: '🎯',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 1,
				milestoneValues: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			})
			.run();

		// 1件の活動でマイルストーン1 (index=0, ratio=0.1) => common
		testDb
			.insert(schema.activityLogs)
			.values({ childId: 1, activityId: 1, points: 5, recordedDate: '2026-03-01' })
			.run();

		const first = await checkAndUnlockAchievements(1, 'test-tenant');
		const m1 = first.find((a) => a.code === 'rarity_test' && a.milestoneValue === 1);
		expect(m1?.rarity).toBe('common');
	});

	it('ratio >= 0.3 で rare を返す', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'rarity_rare_test',
				name: 'レアテスト',
				icon: '🎯',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 1,
				milestoneValues: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			})
			.run();

		// 3件の活動で M=1(common), M=2(common), M=3(rare: index=2, ratio=0.3)
		for (const d of ['2026-03-01', '2026-03-02', '2026-03-03']) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: d })
				.run();
		}

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const m3 = unlocked.find((a) => a.code === 'rarity_rare_test' && a.milestoneValue === 3);
		expect(m3?.rarity).toBe('rare');
	});

	it('ratio >= 0.6 で epic を返す', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'rarity_epic_test',
				name: 'エピックテスト',
				icon: '🎯',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 1,
				milestoneValues: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			})
			.run();

		// 6件の活動で M=6 (index=5, ratio=0.6) => epic
		for (let i = 1; i <= 6; i++) {
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: `2026-03-0${i}` })
				.run();
		}

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const m6 = unlocked.find((a) => a.code === 'rarity_epic_test' && a.milestoneValue === 6);
		expect(m6?.rarity).toBe('epic');
	});

	it('ratio >= 0.9 で legendary を返す', async () => {
		testDb
			.insert(schema.achievements)
			.values({
				code: 'rarity_legendary_test',
				name: 'レジェンダリテスト',
				icon: '🎯',
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
				repeatable: 1,
				milestoneValues: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
			})
			.run();

		// 10件の活動で M=9 (index=8, ratio=0.9) => legendary, M=10 (index=9, ratio=1.0) => legendary
		for (let i = 1; i <= 10; i++) {
			const day = i < 10 ? `0${i}` : `${i}`;
			testDb
				.insert(schema.activityLogs)
				.values({ childId: 1, activityId: 1, points: 5, recordedDate: `2026-03-${day}` })
				.run();
		}

		const unlocked = await checkAndUnlockAchievements(1, 'test-tenant');
		const m9 = unlocked.find((a) => a.code === 'rarity_legendary_test' && a.milestoneValue === 9);
		const m10 = unlocked.find((a) => a.code === 'rarity_legendary_test' && a.milestoneValue === 10);
		expect(m9?.rarity).toBe('legendary');
		expect(m10?.rarity).toBe('legendary');
	});
});

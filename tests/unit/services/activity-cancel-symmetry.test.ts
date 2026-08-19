// tests/unit/services/activity-cancel-symmetry.test.ts
// #4686: 活動の「とりけし」で optional 付与 (コンボ / デイリーミッション / 週次チャレンジ進捗 /
// 今日のおやくそく全達成ボーナス) が付与経路と同じ経路で巻き戻り、残高・達成状態が記録前と一致する
// (sqlite 経路。dsql 経路は activity-record-dsql-pglite.test.ts [E3] が total_point の対称性を assert)。
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asActivityId, asCategoryId, asChildId } from '../../../src/lib/domain/ids';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb,
	seedChildActivities,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

const TODAY = '2026-02-20';
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => TODAY,
}));
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
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { insertDailyMission } from '../../../src/lib/server/db/sqlite/daily-mission-repo';
import {
	cancelActivityLog,
	recordActivity,
} from '../../../src/lib/server/services/activity-log-service';
import { tryGrantMustCompletionBonus } from '../../../src/lib/server/services/activity-service';
import { getTodayMissions } from '../../../src/lib/server/services/daily-mission-service';

const TENANT = 'test-tenant';
const CHILD = asChildId(1);

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});
afterAll(() => {
	closeDb(sqlite);
});

function seedBase(opts: { mustAll?: boolean } = {}) {
	resetDb(sqlite);
	testDb.insert(schema.children).values({ nickname: 'テスト子', age: 8, theme: 'blue' }).run();
	// 5 カテゴリ × 1 活動 (cross-category combo を起こせる構成)
	seedChildActivities(testDb, 1, [
		{
			name: 'たいそう',
			categoryId: asCategoryId(1),
			icon: '🤸',
			basePoints: 5,
			priority: opts.mustAll ? 'must' : 'optional',
		},
		{
			name: 'えほん',
			categoryId: asCategoryId(2),
			icon: '📖',
			basePoints: 5,
			priority: opts.mustAll ? 'must' : 'optional',
		},
		{ name: 'あいさつ', categoryId: asCategoryId(3), icon: '👋', basePoints: 5 },
		{ name: 'おかたづけ', categoryId: asCategoryId(4), icon: '🧹', basePoints: 5 },
		{ name: 'おえかき', categoryId: asCategoryId(5), icon: '🎨', basePoints: 5 },
	]);
}

function ledger() {
	return testDb.select().from(schema.pointLedger).where(eq(schema.pointLedger.childId, 1)).all();
}
function balance(): number {
	return ledger().reduce((s, e) => s + e.amount, 0);
}
function sumType(type: string): number {
	return ledger()
		.filter((e) => e.type === type)
		.reduce((s, e) => s + e.amount, 0);
}

describe('#4686 コンボボーナスの対称巻き戻し', () => {
	beforeEach(() => seedBase());

	it('2 種目目の記録で付いたコンボ (にとうりゅう +3) が、その記録のとりけしで同額マイナス計上され残高は記録前と一致する', async () => {
		const a = assertSuccess(await recordActivity(CHILD, asActivityId(1), TENANT));
		const afterA = balance();
		expect(afterA).toBe(a.totalPoints);

		const b = assertSuccess(await recordActivity(CHILD, asActivityId(2), TENANT));
		// 2 カテゴリ = にとうりゅう +3。結果の純増 = 台帳増分
		expect(b.comboBonus?.totalNewBonus).toBe(3);
		expect(balance()).toBe(afterA + b.totalPoints + 3);

		const cancel = await cancelActivityLog(b.id, TENANT);
		if ('error' in cancel) throw new Error(cancel.error);
		expect(sumType('combo_bonus')).toBe(0);
		expect(balance()).toBe(afterA);
		// 巻き戻しは付与と同 type (combo_bonus) の負行 = 付与した経路と同じ経路
		expect(
			ledger()
				.filter((e) => e.type === 'combo_bonus')
				.map((e) => e.amount),
		).toEqual([3, -3]);
	});

	it('とりけし→再記録を繰り返してもコンボは増殖せず、結果ダイアログの純増は常に台帳増分と一致する', async () => {
		await recordActivity(CHILD, asActivityId(1), TENANT);
		for (let i = 0; i < 3; i++) {
			const before = balance();
			const b = assertSuccess(await recordActivity(CHILD, asActivityId(2), TENANT));
			expect(balance() - before).toBe(b.totalPoints + (b.comboBonus?.totalNewBonus ?? 0));
			const cancel = await cancelActivityLog(b.id, TENANT);
			if ('error' in cancel) throw new Error(cancel.error);
			expect(balance()).toBe(before);
		}
		expect(sumType('combo_bonus')).toBe(0);
	});

	it('3 種目 → 1 種目とりけし で tier が降格 (さんみいったい +8 → にとうりゅう +3) し、差分 -5 だけ巻き戻る', async () => {
		await recordActivity(CHILD, asActivityId(1), TENANT);
		await recordActivity(CHILD, asActivityId(2), TENANT);
		const c = assertSuccess(await recordActivity(CHILD, asActivityId(3), TENANT));
		expect(c.comboBonus?.totalNewBonus).toBe(5); // 8 - 3
		expect(sumType('combo_bonus')).toBe(8);
		const cancel = await cancelActivityLog(c.id, TENANT);
		if ('error' in cancel) throw new Error(cancel.error);
		expect(sumType('combo_bonus')).toBe(3);
	});
});

describe('#4686 デイリーミッションの対称巻き戻し', () => {
	beforeEach(async () => {
		seedBase();
		await insertDailyMission(CHILD, TODAY, asActivityId(1), TENANT);
		await insertDailyMission(CHILD, TODAY, asActivityId(2), TENANT);
		await insertDailyMission(CHILD, TODAY, asActivityId(3), TENANT);
	});

	it('2/3 達成ボーナス (+5) が 2 件目のとりけしで巻き戻り、達成バッジも外れる', async () => {
		await recordActivity(CHILD, asActivityId(1), TENANT);
		const b = assertSuccess(await recordActivity(CHILD, asActivityId(2), TENANT));
		expect(b.missionComplete?.bonusAwarded).toBe(5);
		expect(sumType('daily_mission')).toBe(5);

		const cancel = await cancelActivityLog(b.id, TENANT);
		if ('error' in cancel) throw new Error(cancel.error);
		expect(sumType('daily_mission')).toBe(0);
		const status = await getTodayMissions(CHILD, TENANT);
		expect(status.completedCount).toBe(1);
		expect(status.bonusAwarded).toBe(0);
		expect(status.missions.find((m) => m.activityId === asActivityId(2))?.completed).toBe(false);
	});

	it('3/3 (20P) → とりけしで 2/3 (5P) に戻り、再記録で再び 3/3 (+15) になる (二重付与なし)', async () => {
		await recordActivity(CHILD, asActivityId(1), TENANT);
		await recordActivity(CHILD, asActivityId(2), TENANT);
		const c = assertSuccess(await recordActivity(CHILD, asActivityId(3), TENANT));
		expect(c.missionComplete?.bonusAwarded).toBe(15);
		expect(sumType('daily_mission')).toBe(20);

		const cancel = await cancelActivityLog(c.id, TENANT);
		if ('error' in cancel) throw new Error(cancel.error);
		expect(sumType('daily_mission')).toBe(5);

		const again = assertSuccess(await recordActivity(CHILD, asActivityId(3), TENANT));
		expect(again.missionComplete?.bonusAwarded).toBe(15);
		expect(sumType('daily_mission')).toBe(20);
		expect((await getTodayMissions(CHILD, TENANT)).allComplete).toBe(true);
	});
});

describe('#4686 週次チャレンジ進捗の対称巻き戻し', () => {
	beforeEach(() => {
		seedBase();
		testDb
			.insert(schema.childChallenges)
			.values({
				childId: 1,
				title: 'うんどう 2 かい',
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '2026-02-16',
				endDate: '2026-02-22',
				targetConfig: JSON.stringify({ metric: 'count', categoryId: 1, baseTarget: 2 }),
				rewardConfig: JSON.stringify({ points: 30 }),
				status: 'active',
				isActive: 1,
				currentValue: 0,
				targetValue: 2,
			})
			.run();
	});

	function challenge() {
		return testDb
			.select()
			.from(schema.childChallenges)
			.where(eq(schema.childChallenges.id, 1))
			.get();
	}

	it('記録で +1 した進捗がとりけしで -1 に戻る (同 category のみ)', async () => {
		const a = assertSuccess(await recordActivity(CHILD, asActivityId(1), TENANT));
		expect(challenge()?.currentValue).toBe(1);
		// 別 category の記録は進捗に無関係
		const b = assertSuccess(await recordActivity(CHILD, asActivityId(2), TENANT));
		expect(challenge()?.currentValue).toBe(1);
		await cancelActivityLog(b.id, TENANT);
		expect(challenge()?.currentValue).toBe(1);
		await cancelActivityLog(a.id, TENANT);
		expect(challenge()?.currentValue).toBe(0);
	});

	it('達成 (completed=1、未受取) 直後のとりけしで完了が外れ、受取済みなら触らない', async () => {
		await recordActivity(CHILD, asActivityId(1), TENANT);
		// 同日同活動 2 回目は記録できないため 2 回目は別の category=1 活動を seed
		seedChildActivities(testDb, 1, [
			{ name: 'かけっこ', categoryId: asCategoryId(1), icon: '🏃', basePoints: 5 },
		]);
		const second = assertSuccess(await recordActivity(CHILD, asActivityId(6), TENANT));
		expect(challenge()?.completed).toBe(1);
		expect(challenge()?.currentValue).toBe(2);

		await cancelActivityLog(second.id, TENANT);
		expect(challenge()?.completed).toBe(0);
		expect(challenge()?.status).toBe('active');
		expect(challenge()?.currentValue).toBe(1);

		// 受取済みの完了は巻き戻さない (受取済ポイントとの整合)
		const third = assertSuccess(await recordActivity(CHILD, asActivityId(6), TENANT));
		expect(challenge()?.completed).toBe(1);
		testDb
			.update(schema.childChallenges)
			.set({ rewardClaimed: 1, rewardClaimedAt: new Date().toISOString() })
			.where(eq(schema.childChallenges.id, 1))
			.run();
		await cancelActivityLog(third.id, TENANT);
		expect(challenge()?.completed).toBe(1);
		expect(challenge()?.currentValue).toBe(2);
	});
});

describe('#4686 今日のおやくそく全達成ボーナスの対称巻き戻し', () => {
	beforeEach(() => seedBase({ mustAll: true }));

	it('全達成で付いたボーナスが、1 件のとりけしで巻き戻り、再達成で再付与される (二重付与なし)', async () => {
		await recordActivity(CHILD, asActivityId(1), TENANT);
		const b = assertSuccess(await recordActivity(CHILD, asActivityId(2), TENANT));
		const granted = await tryGrantMustCompletionBonus(CHILD, TODAY, 'elementary', TENANT);
		expect(granted.granted).toBe(true);
		expect(granted.points).toBeGreaterThan(0);
		expect(sumType('must_completion_bonus')).toBe(granted.points);
		// 2 回目の評価は付与しない (冪等)
		expect((await tryGrantMustCompletionBonus(CHILD, TODAY, 'elementary', TENANT)).granted).toBe(
			false,
		);

		await cancelActivityLog(b.id, TENANT);
		expect(sumType('must_completion_bonus')).toBe(0);

		await recordActivity(CHILD, asActivityId(2), TENANT);
		const grantedAgain = await tryGrantMustCompletionBonus(CHILD, TODAY, 'elementary', TENANT);
		expect(grantedAgain.granted).toBe(true);
		expect(sumType('must_completion_bonus')).toBe(granted.points);
	});
});

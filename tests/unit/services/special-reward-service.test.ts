// tests/unit/services/special-reward-service.test.ts
// 特別報酬サービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertError, assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

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

import {
	checkAndGrantFixedIntervalReward,
	getChildSpecialRewards,
	getRewardTemplates,
	getSpecialRewardProgress,
	getUnshownReward,
	grantSpecialReward,
	markRewardShown,
	SPECIAL_REWARD_INTERVAL,
	saveRewardTemplates,
} from '../../../src/lib/server/services/special-reward-service';

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
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

describe('grantSpecialReward', () => {
	beforeEach(() => {
		seedBase();
	});

	it('正常に特別報酬を付与できる', async () => {
		const result = assertSuccess(
			await grantSpecialReward(
				{
					childId: 1,
					title: 'テスト100点',
					points: 100,
					category: 'academic',
				},
				'test-tenant',
			),
		);

		expect(result.id).toBe(1);
		expect(result.childId).toBe(1);
		expect(result.title).toBe('テスト100点');
		expect(result.points).toBe(100);
		expect(result.category).toBe('academic');
		expect(result.grantedAt).toBeDefined();
	});

	it('オプションフィールド付きで付与できる', async () => {
		const result = assertSuccess(
			await grantSpecialReward(
				{
					childId: 1,
					title: '漢字検定合格',
					description: '漢字検定10級に合格！',
					points: 200,
					icon: '📜',
					category: 'academic',
				},
				'test-tenant',
			),
		);

		expect(result.description).toBe('漢字検定10級に合格！');
		expect(result.icon).toBe('📜');
	});

	it('ポイント台帳に special_reward エントリが追加される', async () => {
		await grantSpecialReward(
			{
				childId: 1,
				title: 'テスト満点',
				points: 50,
				category: 'academic',
			},
			'test-tenant',
		);

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.amount).toBe(50);
		expect(ledger[0]?.type).toBe('special_reward');
		expect(ledger[0]?.description).toBe('テスト満点');
	});

	it('存在しない子供にはエラーを返す', async () => {
		const result = assertError(
			await grantSpecialReward(
				{
					childId: 999,
					title: 'テスト',
					points: 50,
					category: 'other',
				},
				'test-tenant',
			),
		);

		expect(result.error).toBe('NOT_FOUND');
		expect(result.target).toBe('child');
	});

	it('複数回付与できる', async () => {
		await grantSpecialReward(
			{ childId: 1, title: '1回目', points: 50, category: 'academic' },
			'test-tenant',
		);
		await grantSpecialReward(
			{ childId: 1, title: '2回目', points: 100, category: 'sports' },
			'test-tenant',
		);

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(2);

		const total = ledger.reduce((sum, e) => sum + e.amount, 0);
		expect(total).toBe(150);
	});
});

describe('getChildSpecialRewards', () => {
	beforeEach(() => {
		seedBase();
	});

	it('空の履歴を返す', async () => {
		const result = await getChildSpecialRewards(1, 'test-tenant');
		expect(result.rewards).toHaveLength(0);
		expect(result.totalPoints).toBe(0);
	});

	it('付与した報酬の履歴を返す', async () => {
		await grantSpecialReward(
			{
				childId: 1,
				title: 'テスト満点',
				points: 100,
				category: 'academic',
			},
			'test-tenant',
		);
		await grantSpecialReward(
			{ childId: 1, title: '大会入賞', points: 150, category: 'sports' },
			'test-tenant',
		);

		const result = await getChildSpecialRewards(1, 'test-tenant');
		expect(result.rewards).toHaveLength(2);
		expect(result.totalPoints).toBe(250);
	});

	it('降順で返される', async () => {
		await grantSpecialReward(
			{ childId: 1, title: '1番目', points: 50, category: 'other' },
			'test-tenant',
		);
		await grantSpecialReward(
			{ childId: 1, title: '2番目', points: 100, category: 'other' },
			'test-tenant',
		);

		const result = await getChildSpecialRewards(1, 'test-tenant');
		// 最新が先頭
		expect(result.rewards[0]?.title).toBe('2番目');
		expect(result.rewards[1]?.title).toBe('1番目');
	});
});

describe('getUnshownReward / markRewardShown', () => {
	beforeEach(() => {
		seedBase();
	});

	it('未表示報酬がない場合nullを返す', async () => {
		const result = await getUnshownReward(1, 'test-tenant');
		expect(result).toBeNull();
	});

	it('未表示の報酬を1件返す', async () => {
		await grantSpecialReward(
			{
				childId: 1,
				title: 'テスト100点',
				points: 100,
				category: 'academic',
			},
			'test-tenant',
		);
		const result = await getUnshownReward(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe('テスト100点');
	});

	it('表示済みにした報酬は返さない', async () => {
		const reward = assertSuccess(
			await grantSpecialReward(
				{ childId: 1, title: 'テスト100点', points: 100, category: 'academic' },
				'test-tenant',
			),
		);
		await markRewardShown(reward.id, 'test-tenant');
		const result = await getUnshownReward(1, 'test-tenant');
		expect(result).toBeNull();
	});

	it('複数の報酬がある場合、未表示のものだけ返す', async () => {
		const r1 = assertSuccess(
			await grantSpecialReward(
				{ childId: 1, title: '1回目', points: 50, category: 'academic' },
				'test-tenant',
			),
		);
		await grantSpecialReward(
			{ childId: 1, title: '2回目', points: 100, category: 'sports' },
			'test-tenant',
		);

		// 1回目を表示済みにする
		await markRewardShown(r1.id, 'test-tenant');

		const result = await getUnshownReward(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe('2回目');
	});

	it('新しいごほうびを付与すると再度表示される', async () => {
		const r1 = assertSuccess(
			await grantSpecialReward(
				{ childId: 1, title: '1回目', points: 50, category: 'academic' },
				'test-tenant',
			),
		);
		await markRewardShown(r1.id, 'test-tenant');

		// 新しい報酬を付与
		await grantSpecialReward(
			{ childId: 1, title: '2回目', points: 100, category: 'sports' },
			'test-tenant',
		);
		const result = await getUnshownReward(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe('2回目');
	});
});

describe('getRewardTemplates / saveRewardTemplates', () => {
	beforeEach(() => {
		seedBase();
	});

	it('テンプレート未設定時は空配列を返す', async () => {
		const templates = await getRewardTemplates('test-tenant');
		expect(templates).toEqual([]);
	});

	it('テンプレートを保存・取得できる', async () => {
		const data = [
			{ title: 'テスト100点', points: 100, icon: '🎓', category: 'academic' as const },
			{ title: '大会入賞', points: 150, icon: '🏆', category: 'sports' as const },
		];

		await saveRewardTemplates(data, 'test-tenant');
		const templates = await getRewardTemplates('test-tenant');
		expect(templates).toHaveLength(2);
		expect(templates[0]?.title).toBe('テスト100点');
		expect(templates[1]?.category).toBe('sports');
	});

	it('テンプレートを上書きできる', async () => {
		await saveRewardTemplates(
			[{ title: '旧テンプレ', points: 50, category: 'other' as const }],
			'test-tenant',
		);

		await saveRewardTemplates(
			[
				{ title: '新テンプレ1', points: 100, category: 'academic' as const },
				{ title: '新テンプレ2', points: 200, category: 'sports' as const },
			],
			'test-tenant',
		);

		const templates = await getRewardTemplates('test-tenant');
		expect(templates).toHaveLength(2);
		expect(templates[0]?.title).toBe('新テンプレ1');
	});
});

// --- Helper: seed activity logs ---
function seedWithActivity() {
	seedBase();
	// Add an activity for the child to record
	testDb
		.insert(schema.activities)
		.values({
			name: 'テスト活動',
			categoryId: 1,
			basePoints: 10,
			icon: '🏃',
		})
		.run();
}

function insertActivityLogs(count: number) {
	for (let i = 0; i < count; i++) {
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 10,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
				recordedAt: new Date().toISOString(),
				cancelled: 0,
			})
			.run();
	}
}

describe('checkAndGrantFixedIntervalReward', () => {
	beforeEach(() => {
		seedWithActivity();
	});

	it('記録数がINTERVALの倍数でない場合はnullを返す', async () => {
		insertActivityLogs(3); // 3 records, interval is 5

		const result = await checkAndGrantFixedIntervalReward(1, 'test-tenant');
		expect(result).toBeNull();
	});

	it('記録数がINTERVALの倍数の場合に報酬を自動付与する', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL); // exactly 5 records

		const result = await checkAndGrantFixedIntervalReward(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe(`${SPECIAL_REWARD_INTERVAL}かいきろく達成！`);
		expect(result?.points).toBe(50);
		expect(result?.category).toBe('auto_milestone');
	});

	it('10回目の記録でも報酬が付与される', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL * 2); // 10 records

		const result = await checkAndGrantFixedIntervalReward(1, 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe(`${SPECIAL_REWARD_INTERVAL * 2}かいきろく達成！`);
	});

	it('記録数が0の場合はnullを返す', async () => {
		// No activity logs inserted
		const result = await checkAndGrantFixedIntervalReward(1, 'test-tenant');
		expect(result).toBeNull();
	});

	it('存在しない子供にはnullを返す', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL);
		// child 999 does not exist, but activity logs are for child 1
		const result = await checkAndGrantFixedIntervalReward(999, 'test-tenant');
		expect(result).toBeNull();
	});

	it('付与された報酬がポイント台帳に記録される', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL);

		await checkAndGrantFixedIntervalReward(1, 'test-tenant');

		const ledger = testDb.select().from(schema.pointLedger).all();
		const autoRewardEntry = ledger.find((e) => e.type === 'special_reward');
		expect(autoRewardEntry).toBeDefined();
		expect(autoRewardEntry?.amount).toBe(50);
	});

	it('付与された報酬は未表示として検出される', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL);

		await checkAndGrantFixedIntervalReward(1, 'test-tenant');

		const unshown = await getUnshownReward(1, 'test-tenant');
		expect(unshown).not.toBeNull();
		expect(unshown?.category).toBe('auto_milestone');
	});
});

describe('getSpecialRewardProgress', () => {
	beforeEach(() => {
		seedWithActivity();
	});

	it('記録なしの場合はremaining=INTERVALを返す', async () => {
		const progress = await getSpecialRewardProgress(1, 'test-tenant');
		expect(progress.totalRecords).toBe(0);
		expect(progress.interval).toBe(SPECIAL_REWARD_INTERVAL);
		expect(progress.remaining).toBe(0); // 0 % 5 = 0 → remaining = 0
	});

	it('1回記録後はremaining=4を返す', async () => {
		insertActivityLogs(1);

		const progress = await getSpecialRewardProgress(1, 'test-tenant');
		expect(progress.totalRecords).toBe(1);
		expect(progress.remaining).toBe(SPECIAL_REWARD_INTERVAL - 1);
	});

	it('4回記録後はremaining=1を返す', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL - 1);

		const progress = await getSpecialRewardProgress(1, 'test-tenant');
		expect(progress.totalRecords).toBe(SPECIAL_REWARD_INTERVAL - 1);
		expect(progress.remaining).toBe(1);
	});

	it('INTERVALちょうどの場合はremaining=0を返す', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL);

		const progress = await getSpecialRewardProgress(1, 'test-tenant');
		expect(progress.totalRecords).toBe(SPECIAL_REWARD_INTERVAL);
		expect(progress.remaining).toBe(0);
	});

	it('INTERVAL+1の場合はremaining=INTERVAL-1を返す', async () => {
		insertActivityLogs(SPECIAL_REWARD_INTERVAL + 1);

		const progress = await getSpecialRewardProgress(1, 'test-tenant');
		expect(progress.totalRecords).toBe(SPECIAL_REWARD_INTERVAL + 1);
		expect(progress.remaining).toBe(SPECIAL_REWARD_INTERVAL - 1);
	});
});

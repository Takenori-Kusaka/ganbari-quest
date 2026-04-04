// tests/unit/services/special-reward-auto.test.ts
// 固定間隔自動ごほうび (#326) のユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	type TestDb,
	type TestSqlite,
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
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
	checkAndGrantAutoReward,
	getAutoRewardInterval,
	getRewardProgress,
	isAutoRewardEnabled,
	saveRewardTemplates,
	setAutoRewardEnabled,
	setAutoRewardInterval,
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
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 6, theme: 'pink' }).run();
	testDb
		.insert(schema.activities)
		.values({
			name: 'テスト活動',
			categoryId: 1,
			icon: '🏃',
			basePoints: 5,
		})
		.run();
}

/** Insert N activity log records for the test child. */
function insertActivityLogs(count: number) {
	for (let i = 0; i < count; i++) {
		const date = `2026-04-0${String((i % 9) + 1)}`;
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: date,
				recordedAt: new Date().toISOString(),
				cancelled: 0,
			})
			.run();
	}
}

const TENANT = 'test-tenant';

describe('getRewardProgress', () => {
	beforeEach(() => {
		seedBase();
	});

	it('デフォルトで自動ごほうびが有効、インターバル5', async () => {
		const enabled = await isAutoRewardEnabled(TENANT);
		expect(enabled).toBe(true);

		const interval = await getAutoRewardInterval(TENANT);
		expect(interval).toBe(5);
	});

	it('活動記録がない場合は current=0, remaining=5', async () => {
		const progress = await getRewardProgress(1, TENANT);
		expect(progress).not.toBeNull();
		expect(progress?.current).toBe(0);
		expect(progress?.target).toBe(5);
		expect(progress?.remaining).toBe(5);
	});

	it('3回記録後は current=3, remaining=2', async () => {
		insertActivityLogs(3);
		const progress = await getRewardProgress(1, TENANT);
		expect(progress?.current).toBe(3);
		expect(progress?.remaining).toBe(2);
	});

	it('自動ごほうびを無効にするとnullを返す', async () => {
		await setAutoRewardEnabled(false, TENANT);
		const progress = await getRewardProgress(1, TENANT);
		expect(progress).toBeNull();
	});

	it('インターバルを変更すると反映される', async () => {
		await setAutoRewardInterval(10, TENANT);
		insertActivityLogs(3);
		const progress = await getRewardProgress(1, TENANT);
		expect(progress?.target).toBe(10);
		expect(progress?.remaining).toBe(7);
	});
});

describe('checkAndGrantAutoReward', () => {
	beforeEach(() => {
		seedBase();
	});

	it('インターバル未到達の場合はnullを返す', async () => {
		insertActivityLogs(3);
		const result = await checkAndGrantAutoReward(1, TENANT);
		expect(result).toBeNull();
	});

	it('インターバル到達時に自動ごほうびを付与する', async () => {
		insertActivityLogs(5);
		const result = await checkAndGrantAutoReward(1, TENANT);
		expect(result).not.toBeNull();
		expect(result?.title).toBe('がんばりボーナス');
		expect(result?.points).toBe(50);
		expect(result?.childId).toBe(1);
	});

	it('自動ごほうび付与後はカウンターがリセットされる', async () => {
		insertActivityLogs(5);
		await checkAndGrantAutoReward(1, TENANT);

		// リセット後は current=0
		const progress = await getRewardProgress(1, TENANT);
		expect(progress?.current).toBe(0);
		expect(progress?.remaining).toBe(5);
	});

	it('さらに記録を積んで再度到達すると再付与される', async () => {
		insertActivityLogs(5);
		await checkAndGrantAutoReward(1, TENANT);

		// もう5回追加
		insertActivityLogs(5);
		const result = await checkAndGrantAutoReward(1, TENANT);
		expect(result).not.toBeNull();
		expect(result?.title).toBe('がんばりボーナス');
	});

	it('テンプレートがある場合はテンプレートから選ばれる', async () => {
		await saveRewardTemplates(
			[{ title: 'テスト100点', points: 100, icon: '🎓', category: 'academic' as const }],
			TENANT,
		);

		insertActivityLogs(5);
		const result = await checkAndGrantAutoReward(1, TENANT);
		expect(result).not.toBeNull();
		expect(result?.title).toBe('テスト100点');
		expect(result?.points).toBe(100);
	});

	it('自動ごほうびが無効の場合はnullを返す', async () => {
		await setAutoRewardEnabled(false, TENANT);
		insertActivityLogs(10);
		const result = await checkAndGrantAutoReward(1, TENANT);
		expect(result).toBeNull();
	});

	it('ポイント台帳に special_reward エントリが追加される', async () => {
		insertActivityLogs(5);
		await checkAndGrantAutoReward(1, TENANT);

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger.some((e) => e.type === 'special_reward')).toBe(true);
	});

	it('special_rewards テーブルにレコードが挿入される', async () => {
		insertActivityLogs(5);
		await checkAndGrantAutoReward(1, TENANT);

		const rewards = testDb.select().from(schema.specialRewards).all();
		expect(rewards).toHaveLength(1);
		expect(rewards[0]?.title).toBe('がんばりボーナス');
	});

	it('インターバルを超過した場合でも正しく動作する', async () => {
		// 7回記録（インターバル5を超過）
		insertActivityLogs(7);
		const result = await checkAndGrantAutoReward(1, TENANT);
		expect(result).not.toBeNull();

		// last_countが7に設定される
		const progress = await getRewardProgress(1, TENANT);
		expect(progress?.current).toBe(0);
	});
});

describe('setAutoRewardInterval / setAutoRewardEnabled', () => {
	beforeEach(() => {
		seedBase();
	});

	it('インターバルを設定・取得できる', async () => {
		await setAutoRewardInterval(10, TENANT);
		const interval = await getAutoRewardInterval(TENANT);
		expect(interval).toBe(10);
	});

	it('自動ごほうびの有効/無効を切り替えできる', async () => {
		await setAutoRewardEnabled(false, TENANT);
		expect(await isAutoRewardEnabled(TENANT)).toBe(false);

		await setAutoRewardEnabled(true, TENANT);
		expect(await isAutoRewardEnabled(TENANT)).toBe(true);
	});
});

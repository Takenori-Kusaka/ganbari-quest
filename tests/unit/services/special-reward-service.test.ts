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
	approveRedemption,
	getRedemptionRequestsForParent,
	rejectRedemption,
	requestRedemption,
} from '../../../src/lib/server/services/reward-redemption-service';
import {
	checkAndGrantFixedIntervalReward,
	deleteReward,
	getChildSpecialRewards,
	getRewardTemplates,
	getSpecialRewardProgress,
	getUnshownReward,
	grantSpecialReward,
	markRewardShown,
	SPECIAL_REWARD_INTERVAL,
	saveRewardTemplates,
	updateReward,
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
		await markRewardShown(1, reward.id, 'test-tenant');
		const result = await getUnshownReward(1, 'test-tenant');
		expect(result).toBeNull();
	});

	it('#2845 課題① / B1: 他の childId では表示済みにできない (所有権検証、SQLite backend)', async () => {
		const reward = assertSuccess(
			await grantSpecialReward(
				{ childId: 1, title: 'テスト100点', points: 100, category: 'academic' },
				'test-tenant',
			),
		);
		// childId=999 (別の子) を指定して rewardId だけ一致させても更新されない
		const ok = await markRewardShown(999, reward.id, 'test-tenant');
		expect(ok).toBe(false);
		// 本来の子の未表示報酬は残る (silent 越境更新が起きていない)
		const result = await getUnshownReward(1, 'test-tenant');
		expect(result?.id).toBe(reward.id);
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
		await markRewardShown(1, r1.id, 'test-tenant');

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
		await markRewardShown(1, r1.id, 'test-tenant');

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
	// #2362 PR-3 Phase 7b-2c: child_activities へ insert (childId=1)
	testDb
		.insert(schema.childActivities)
		.values({
			childId: 1,
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

// ============================================================
// #2832: updateReward / deleteReward (pending redemption ガード + 申請時点 snapshot)
// ============================================================

describe('#2832 deleteReward / updateReward (pending redemption ガード)', () => {
	/** 子供 + ポイント残高 + reward を seed し、id を返す */
	function seedRewardWithBalance() {
		resetDb();
		sqlite
			.prepare(`INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, ?, ?, ?)`)
			.run('テストちゃん', 8, 'blue', 'elementary');
		const childRow = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
		sqlite
			.prepare(
				`INSERT INTO point_ledger (child_id, amount, type, description, created_at)
				 VALUES (?, 100, 'activity', 'テスト付与', CURRENT_TIMESTAMP)`,
			)
			.run(childRow.id);
		sqlite
			.prepare(
				`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
				 VALUES (?, 'ゲーム時間30分', 80, '🎮', 'とくべつ', CURRENT_TIMESTAMP)`,
			)
			.run(childRow.id);
		const rewardRow = sqlite.prepare('SELECT id FROM special_rewards LIMIT 1').get() as {
			id: number;
		};
		return { childId: childRow.id, rewardId: rewardRow.id };
	}

	it('AC1: pending redemption 中の削除は PENDING_REDEMPTION で拒否される', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);

		const result = await deleteReward(rewardId, childId, 'test-tenant');
		expect(result).toEqual({ error: 'PENDING_REDEMPTION' });

		// reward は削除されていない
		const remaining = sqlite
			.prepare('SELECT COUNT(*) AS c FROM special_rewards WHERE id = ?')
			.get(rewardId) as { c: number };
		expect(remaining.c).toBe(1);
	});

	it('AC3: pending 解消 (却下) 後は削除でき、解決済の申請履歴行も削除される', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);
		if ('error' in req) return;

		const rejected = await rejectRedemption(req.id, 'いまは だめ', 'test-tenant');
		expect('error' in rejected).toBe(false);

		const result = await deleteReward(rewardId, childId, 'test-tenant');
		expect(result).toEqual({ deleted: true });

		const remaining = sqlite
			.prepare('SELECT COUNT(*) AS c FROM special_rewards WHERE id = ?')
			.get(rewardId) as { c: number };
		expect(remaining.c).toBe(0);
		// FK 整合: 解決済の交換申請履歴行も削除される (repo 層 cascade)
		const requests = sqlite
			.prepare('SELECT COUNT(*) AS c FROM reward_redemption_requests WHERE reward_id = ?')
			.get(rewardId) as { c: number };
		expect(requests.c).toBe(0);
	});

	it('pending が無い reward は削除できる', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const result = await deleteReward(rewardId, childId, 'test-tenant');
		expect(result).toEqual({ deleted: true });
	});

	it('他の child を指定した削除は NOT_FOUND (IDOR 防御)', async () => {
		const { rewardId } = seedRewardWithBalance();
		const result = await deleteReward(rewardId, 999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'reward' });
	});

	it('AC2 (案 b): 編集は pending redemption 中も成功する', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);

		const result = await updateReward(
			rewardId,
			childId,
			{ title: 'ゲーム時間60分', points: 50, icon: '🕹️' },
			'test-tenant',
		);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.title).toBe('ゲーム時間60分');
		expect(result.points).toBe(50);
	});

	it('AC2: 編集後も pending 申請は申請時点 snapshot (名前/ポイント) で表示される', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);

		await updateReward(rewardId, childId, { title: '新しい名前', points: 10 }, 'test-tenant');

		const rows = await getRedemptionRequestsForParent('test-tenant', {
			status: 'pending_parent_approval',
		});
		expect(rows).toHaveLength(1);
		// 申請時点 snapshot のまま (編集後の値ではない)
		expect(rows[0]?.rewardTitle).toBe('ゲーム時間30分');
		expect(rows[0]?.rewardPoints).toBe(80);
	});

	it('AC2: 承認時の控除ポイントも申請時点 snapshot (編集後の値ではない)', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);
		if ('error' in req) return;

		await updateReward(rewardId, childId, { title: 'ゲーム時間30分', points: 10 }, 'test-tenant');

		const approved = await approveRedemption(req.id, 1, 'test-tenant');
		expect('error' in approved).toBe(false);

		const entry = sqlite
			.prepare(
				`SELECT amount FROM point_ledger WHERE type = 'reward_redemption' AND reference_id = ?`,
			)
			.get(req.id) as { amount: number } | undefined;
		expect(entry?.amount).toBe(-80);
	});

	it('snapshot 列が NULL の旧行は live JOIN 値に fallback する (NULL 混在行)', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		// snapshot 列導入前の旧行を再現 (reward_title / reward_points / reward_icon = NULL)
		sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests (child_id, reward_id, requested_at, status)
				 VALUES (?, ?, ?, 'pending_parent_approval')`,
			)
			.run(childId, rewardId, Math.floor(Date.now() / 1000));

		const rows = await getRedemptionRequestsForParent('test-tenant', {
			status: 'pending_parent_approval',
		});
		expect(rows).toHaveLength(1);
		// live JOIN 値 (special_rewards) に fallback
		expect(rows[0]?.rewardTitle).toBe('ゲーム時間30分');
		expect(rows[0]?.rewardPoints).toBe(80);
	});

	it('存在しない reward の編集は NOT_FOUND', async () => {
		const { childId } = seedRewardWithBalance();
		const result = await updateReward(9999, childId, { title: 'x', points: 1 }, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'reward' });
	});
});

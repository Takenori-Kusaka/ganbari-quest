import { asChildId } from '$lib/domain/ids';
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
	getRedemptionRequestsForChild,
	getRedemptionRequestsForParent,
	rejectRedemption,
	requestRedemption,
} from '../../../src/lib/server/services/reward-redemption-service';
import {
	deleteReward,
	getChildSpecialRewards,
	getRewardTemplates,
	getUnshownReward,
	grantSpecialReward,
	markRewardShown,
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
					childId: asChildId(1),
					title: 'テスト100点',
					points: 100,
					category: 'academic',
				},
				'test-tenant',
			),
		);

		expect(result.id).toBe('1');
		expect(result.childId).toBe('1');
		expect(result.title).toBe('テスト100点');
		expect(result.points).toBe(100);
		expect(result.category).toBe('academic');
		expect(result.grantedAt).toBeDefined();
	});

	it('オプションフィールド付きで付与できる', async () => {
		const result = assertSuccess(
			await grantSpecialReward(
				{
					childId: asChildId(1),
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

	// #4172: 棚への陳列は通貨を発行しない。旧仕様 (INSERT と同時に同額を point_ledger へ加算) を
	// 検証していた 2 件を、新仕様「加算されないこと」の検証へ反転する (削除ではなく反転で覆域を維持)。
	it('ポイント台帳に special_reward エントリを追加しない (#4172)', async () => {
		await grantSpecialReward(
			{
				childId: asChildId(1),
				title: 'テスト満点',
				points: 50,
				category: 'academic',
			},
			'test-tenant',
		);

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger, 'ごほうびを棚に置いただけで通貨が発行されています').toHaveLength(0);
	});

	it('存在しない子供にはエラーを返す', async () => {
		const result = assertError(
			await grantSpecialReward(
				{
					childId: asChildId(999),
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

	it('複数回陳列でき、いずれも通貨を発行しない (#4172)', async () => {
		await grantSpecialReward(
			{ childId: asChildId(1), title: '1回目', points: 50, category: 'academic' },
			'test-tenant',
		);
		await grantSpecialReward(
			{ childId: asChildId(1), title: '2回目', points: 100, category: 'sports' },
			'test-tenant',
		);

		const rewards = await getChildSpecialRewards(asChildId(1), 'test-tenant');
		expect(rewards.rewards).toHaveLength(2);

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger, '陳列を重ねるほど残高が増えています').toHaveLength(0);
	});
});

describe('getChildSpecialRewards', () => {
	beforeEach(() => {
		seedBase();
	});

	it('空の履歴を返す', async () => {
		const result = await getChildSpecialRewards(asChildId(1), 'test-tenant');
		expect(result.rewards).toHaveLength(0);
		expect(result.totalPoints).toBe(0);
	});

	it('付与した報酬の履歴を返す', async () => {
		await grantSpecialReward(
			{
				childId: asChildId(1),
				title: 'テスト満点',
				points: 100,
				category: 'academic',
			},
			'test-tenant',
		);
		await grantSpecialReward(
			{ childId: asChildId(1), title: '大会入賞', points: 150, category: 'sports' },
			'test-tenant',
		);

		const result = await getChildSpecialRewards(asChildId(1), 'test-tenant');
		expect(result.rewards).toHaveLength(2);
		expect(result.totalPoints).toBe(250);
	});

	it('降順で返される', async () => {
		await grantSpecialReward(
			{ childId: asChildId(1), title: '1番目', points: 50, category: 'other' },
			'test-tenant',
		);
		await grantSpecialReward(
			{ childId: asChildId(1), title: '2番目', points: 100, category: 'other' },
			'test-tenant',
		);

		const result = await getChildSpecialRewards(asChildId(1), 'test-tenant');
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
		const result = await getUnshownReward(asChildId(1), 'test-tenant');
		expect(result).toBeNull();
	});

	it('未表示の報酬を1件返す', async () => {
		await grantSpecialReward(
			{
				childId: asChildId(1),
				title: 'テスト100点',
				points: 100,
				category: 'academic',
			},
			'test-tenant',
		);
		const result = await getUnshownReward(asChildId(1), 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe('テスト100点');
	});

	it('表示済みにした報酬は返さない', async () => {
		const reward = assertSuccess(
			await grantSpecialReward(
				{ childId: asChildId(1), title: 'テスト100点', points: 100, category: 'academic' },
				'test-tenant',
			),
		);
		await markRewardShown(asChildId(1), reward.id, 'test-tenant');
		const result = await getUnshownReward(asChildId(1), 'test-tenant');
		expect(result).toBeNull();
	});

	it('#2845 課題① / B1: 他の childId では表示済みにできない (所有権検証、SQLite backend)', async () => {
		const reward = assertSuccess(
			await grantSpecialReward(
				{ childId: asChildId(1), title: 'テスト100点', points: 100, category: 'academic' },
				'test-tenant',
			),
		);
		// childId=999 (別の子) を指定して rewardId だけ一致させても更新されない
		const ok = await markRewardShown(asChildId(999), reward.id, 'test-tenant');
		expect(ok).toBe(false);
		// 本来の子の未表示報酬は残る (silent 越境更新が起きていない)
		const result = await getUnshownReward(asChildId(1), 'test-tenant');
		expect(result?.id).toBe(reward.id);
	});

	it('複数の報酬がある場合、未表示のものだけ返す', async () => {
		const r1 = assertSuccess(
			await grantSpecialReward(
				{ childId: asChildId(1), title: '1回目', points: 50, category: 'academic' },
				'test-tenant',
			),
		);
		await grantSpecialReward(
			{ childId: asChildId(1), title: '2回目', points: 100, category: 'sports' },
			'test-tenant',
		);

		// 1回目を表示済みにする
		await markRewardShown(asChildId(1), r1.id, 'test-tenant');

		const result = await getUnshownReward(asChildId(1), 'test-tenant');
		expect(result).not.toBeNull();
		expect(result?.title).toBe('2回目');
	});

	it('新しいごほうびを付与すると再度表示される', async () => {
		const r1 = assertSuccess(
			await grantSpecialReward(
				{ childId: asChildId(1), title: '1回目', points: 50, category: 'academic' },
				'test-tenant',
			),
		);
		await markRewardShown(asChildId(1), r1.id, 'test-tenant');

		// 新しい報酬を付与
		await grantSpecialReward(
			{ childId: asChildId(1), title: '2回目', points: 100, category: 'sports' },
			'test-tenant',
		);
		const result = await getUnshownReward(asChildId(1), 'test-tenant');
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
		return { childId: asChildId(childRow.id), rewardId: String(rewardRow.id) };
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
			.get(Number(rewardId)) as { c: number };
		expect(remaining.c).toBe(1);
	});

	// #4683: 旧仕様は「reward 削除時に解決済の申請履歴行も削除する」だった (FK 整合のため)。
	// しかし point_ledger の控除は残るため、子供からは「ポイントが勝手に減った」、親からは
	// 「何に使ったか辿れない」状態になっていた。履歴を残す仕様に反転する (PO 判断)。
	it('AC3 (#4683): pending 解消 (却下) 後は削除でき、解決済の申請履歴行は残る', async () => {
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
			.get(Number(rewardId)) as { c: number };
		expect(remaining.c).toBe(0);
		// #4683: 交換申請履歴は残る (FK は外してあるので reward 消失後も行が生き残る)
		const requests = sqlite
			.prepare('SELECT COUNT(*) AS c FROM reward_redemption_requests WHERE reward_id = ?')
			.get(Number(rewardId)) as { c: number };
		expect(requests.c).toBe(1);
	});

	it('#4683: 承認済みの交換があるごほうびを削除しても、子供履歴・親 History・台帳の 3 者が残る', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);
		if ('error' in req) return;
		const approved = await approveRedemption(req.id, 'parent-1', 'test-tenant');
		expect('error' in approved).toBe(false);

		// 削除前: 台帳に控除が立っている (= 「何に使ったか」の事実)
		const ledgerBefore = sqlite
			.prepare(
				"SELECT COUNT(*) AS c FROM point_ledger WHERE type = 'reward_redemption' AND child_id = ?",
			)
			.get(Number(childId)) as { c: number };
		expect(ledgerBefore.c).toBe(1);

		expect(await deleteReward(rewardId, childId, 'test-tenant')).toEqual({ deleted: true });

		// ① 子供履歴 (findRedemptionRequestsByChild 経由)
		const childHistory = await getRedemptionRequestsForChild(childId, 'test-tenant');
		expect(childHistory).toHaveLength(1);
		expect(childHistory[0]?.status).toBe('approved');

		// ② 親の承認履歴 (WithDetails。reward は消えているので snapshot が権威)
		const parentHistory = await getRedemptionRequestsForParent('test-tenant');
		expect(parentHistory).toHaveLength(1);
		expect(parentHistory[0]?.rewardTitle).toBe('ゲーム時間30分');
		expect(parentHistory[0]?.rewardPoints).toBe(80);
		expect(parentHistory[0]?.rewardIcon).toBe('🎮');

		// ③ 台帳の控除は削除前と同じまま残る
		const ledgerAfter = sqlite
			.prepare(
				"SELECT COUNT(*) AS c FROM point_ledger WHERE type = 'reward_redemption' AND child_id = ?",
			)
			.get(Number(childId)) as { c: number };
		expect(ledgerAfter.c).toBe(1);
	});

	it('#4683: snapshot 未設定の旧行は削除時に live reward の値で backfill される', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		// #2832 より前に作られた行を模す (snapshot 3 列が NULL)
		sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status, resolved_at)
				 VALUES (?, ?, ?, 1, 'approved', ?)`,
			)
			.run(
				Number(childId),
				Number(rewardId),
				Math.floor(Date.now() / 1000) - 3600,
				Math.floor(Date.now() / 1000) - 3500,
			);

		expect(await deleteReward(rewardId, childId, 'test-tenant')).toEqual({ deleted: true });

		const row = sqlite
			.prepare(
				'SELECT reward_title, reward_points, reward_icon FROM reward_redemption_requests WHERE reward_id = ?',
			)
			.get(Number(rewardId)) as {
			reward_title: string | null;
			reward_points: number | null;
			reward_icon: string | null;
		};
		expect(row.reward_title).toBe('ゲーム時間30分');
		expect(row.reward_points).toBe(80);
		expect(row.reward_icon).toBe('🎮');
	});

	it('pending が無い reward は削除できる', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const result = await deleteReward(rewardId, childId, 'test-tenant');
		expect(result).toEqual({ deleted: true });
	});

	it('他の child を指定した削除は NOT_FOUND (IDOR 防御)', async () => {
		const { rewardId } = seedRewardWithBalance();
		const result = await deleteReward(rewardId, asChildId(999), 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'reward' });
	});

	it('AC2 (案 b): 編集は pending redemption 中も成功する', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const req = await requestRedemption(childId, rewardId, 'test-tenant');
		expect('error' in req).toBe(false);

		const result = await updateReward(
			String(rewardId),
			asChildId(childId),
			{ title: 'ゲーム時間60分', points: 50, icon: '🕹️' },
			'test-tenant',
		);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.title).toBe('ゲーム時間60分');
		expect(result.points).toBe(50);
	});

	it('#3154: 編集で shopCategory を変更できる (登録後の陳列系統変更)', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		const result = await updateReward(
			String(rewardId),
			asChildId(childId),
			{ title: 'ゲーム時間30分', points: 80, shopCategory: 'money' },
			'test-tenant',
		);
		// #3183 (ADR-0006): 早期 return だけだと error 退行を緑で通すため明示 assert を前置する
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.shopCategory).toBe('money');

		const cleared = await updateReward(
			String(rewardId),
			asChildId(childId),
			{ title: 'ゲーム時間30分', points: 80, shopCategory: null },
			'test-tenant',
		);
		expect('error' in cleared).toBe(false);
		if ('error' in cleared) return;
		expect(cleared.shopCategory).toBeNull();
	});

	it('#3154: shopCategory 未指定 (undefined) の編集は既存の陳列系統を保全する', async () => {
		const { childId, rewardId } = seedRewardWithBalance();
		await updateReward(
			String(rewardId),
			asChildId(childId),
			{ title: 'ゲーム時間30分', points: 80, shopCategory: 'privilege' },
			'test-tenant',
		);
		const result = await updateReward(
			String(rewardId),
			asChildId(childId),
			{ title: '新タイトル', points: 80 },
			'test-tenant',
		);
		// #3183 (ADR-0006): 早期 return だけだと error 退行を緑で通すため明示 assert を前置する
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.title).toBe('新タイトル');
		expect(result.shopCategory).toBe('privilege');
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

		const approved = await approveRedemption(req.id, 'parent-sub-1', 'test-tenant');
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
		const result = await updateReward(
			'9999',
			asChildId(childId),
			{ title: 'x', points: 1 },
			'test-tenant',
		);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'reward' });
	});
});

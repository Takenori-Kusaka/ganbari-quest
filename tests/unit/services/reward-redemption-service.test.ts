// tests/unit/services/reward-redemption-service.test.ts
// ごほうびショップ交換申請サービスのユニットテスト (#1335)

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
	expireOldRedemptions,
	getRedemptionRequestsForChild,
	getRedemptionRequestsForParent,
	getUnshownRedemptionResult,
	markRedemptionShown,
	rejectRedemption,
	requestRedemption,
} from '../../../src/lib/server/services/reward-redemption-service';

const TENANT_ID = 'test-tenant';

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

/** テスト用の子供と報酬データを準備 */
function seedBaseData() {
	resetDb();
	// 子供を作成（children テーブルに tenantId カラムは存在しないため raw SQL で挿入）
	sqlite
		.prepare(`INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, ?, ?, ?)`)
		.run('テストちゃん', 8, 'blue', 'elementary');
	const childRow = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
	const childId = childRow.id;

	// ポイントを追加（100P）
	sqlite
		.prepare(
			`INSERT INTO point_ledger (child_id, amount, type, description, created_at)
			 VALUES (?, 100, 'activity', 'テスト付与', CURRENT_TIMESTAMP)`,
		)
		.run(childId);

	// 特別報酬を作成（80P）
	sqlite
		.prepare(
			`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
			 VALUES (?, 'ゲーム時間30分', 80, '🎮', 'とくべつ', CURRENT_TIMESTAMP)`,
		)
		.run(childId);
	const rewardRow = sqlite.prepare('SELECT id FROM special_rewards LIMIT 1').get() as {
		id: number;
	};

	return { childId, rewardId: rewardRow.id };
}

describe('requestRedemption', () => {
	it('正常申請が作成される', async () => {
		const { childId, rewardId } = seedBaseData();
		const result = await requestRedemption(childId, rewardId, TENANT_ID);

		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.status).toBe('pending_parent_approval');
		expect(result.childId).toBe(childId);
		expect(result.rewardId).toBe(rewardId);
	});

	it('ポイント不足で INSUFFICIENT_POINTS を返す', async () => {
		resetDb();
		sqlite
			.prepare(`INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, ?, ?, ?)`)
			.run('テストちゃん2', 8, 'blue', 'elementary');
		const childRow = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
		const childId = childRow.id;
		// ポイント0のまま（ledger未挿入）
		sqlite
			.prepare(
				`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
				 VALUES (?, 'ゲーム時間30分', 100, '🎮', 'とくべつ', CURRENT_TIMESTAMP)`,
			)
			.run(childId);
		const rewardRow = sqlite.prepare('SELECT id FROM special_rewards LIMIT 1').get() as {
			id: number;
		};

		const result = await requestRedemption(childId, rewardRow.id, TENANT_ID);
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('重複申請で ALREADY_PENDING を返す', async () => {
		const { childId, rewardId } = seedBaseData();
		// 1回目の申請
		await requestRedemption(childId, rewardId, TENANT_ID);
		// 2回目の申請
		const result = await requestRedemption(childId, rewardId, TENANT_ID);
		expect(result).toEqual({ error: 'ALREADY_PENDING' });
	});

	it('存在しない報酬で REWARD_NOT_FOUND を返す', async () => {
		const { childId } = seedBaseData();
		const result = await requestRedemption(childId, 99999, TENANT_ID);
		expect(result).toEqual({ error: 'REWARD_NOT_FOUND' });
	});
});

describe('approveRedemption', () => {
	it('承認するとポイントが減算され status が approved になる', async () => {
		const { childId, rewardId } = seedBaseData();
		const reqResult = await requestRedemption(childId, rewardId, TENANT_ID);
		expect('error' in reqResult).toBe(false);
		if ('error' in reqResult) return;

		const approveResult = await approveRedemption(reqResult.id, 1, TENANT_ID);
		expect('error' in approveResult).toBe(false);
		if ('error' in approveResult) return;
		expect(approveResult.status).toBe('approved');
		expect(approveResult.resolvedAt).toBeTruthy();

		// ポイント台帳に reward_redemption エントリがあることを確認
		const ledgerEntry = sqlite
			.prepare("SELECT * FROM point_ledger WHERE type = 'reward_redemption' AND child_id = ?")
			.get(childId) as { amount: number } | undefined;
		expect(ledgerEntry).toBeTruthy();
		expect(ledgerEntry!.amount).toBe(-80);
	});

	it('既に承認済みの申請を承認しようとすると INVALID_STATUS', async () => {
		const { childId, rewardId } = seedBaseData();
		const reqResult = await requestRedemption(childId, rewardId, TENANT_ID);
		if ('error' in reqResult) return;

		await approveRedemption(reqResult.id, 1, TENANT_ID);
		const result2 = await approveRedemption(reqResult.id, 1, TENANT_ID);
		expect(result2).toEqual({ error: 'INVALID_STATUS' });
	});
});

describe('rejectRedemption', () => {
	it('却下するとステータスが rejected になる', async () => {
		const { childId, rewardId } = seedBaseData();
		const reqResult = await requestRedemption(childId, rewardId, TENANT_ID);
		if ('error' in reqResult) return;

		const rejectResult = await rejectRedemption(reqResult.id, 'ごめんね', TENANT_ID);
		expect('error' in rejectResult).toBe(false);
		if ('error' in rejectResult) return;
		expect(rejectResult.status).toBe('rejected');
		expect(rejectResult.parentNote).toBe('ごめんね');
	});

	it('100文字を超える却下理由は切り詰められる', async () => {
		const { childId, rewardId } = seedBaseData();
		const reqResult = await requestRedemption(childId, rewardId, TENANT_ID);
		if ('error' in reqResult) return;

		const longNote = 'あ'.repeat(150);
		const rejectResult = await rejectRedemption(reqResult.id, longNote, TENANT_ID);
		if ('error' in rejectResult) return;
		expect(rejectResult.parentNote?.length).toBe(100);
	});
});

describe('getRedemptionRequestsForChild', () => {
	it('子供の申請一覧が取得できる', async () => {
		const { childId, rewardId } = seedBaseData();
		await requestRedemption(childId, rewardId, TENANT_ID);

		const requests = await getRedemptionRequestsForChild(childId, TENANT_ID);
		expect(requests.length).toBe(1);
		expect(requests[0]!.childId).toBe(childId);
	});
});

describe('getRedemptionRequestsForParent', () => {
	it('pending_parent_approval 申請が取得できる', async () => {
		const { childId, rewardId } = seedBaseData();
		await requestRedemption(childId, rewardId, TENANT_ID);

		const requests = await getRedemptionRequestsForParent(TENANT_ID, {
			status: 'pending_parent_approval',
		});
		expect(requests.length).toBe(1);
		expect(requests[0]!.rewardTitle).toBe('ゲーム時間30分');
		expect(requests[0]!.childName).toBe('テストちゃん');
	});
});

describe('getUnshownRedemptionResult / markRedemptionShown', () => {
	it('承認結果が未表示として取得でき、表示済みにすると取得できなくなる', async () => {
		const { childId, rewardId } = seedBaseData();
		const reqResult = await requestRedemption(childId, rewardId, TENANT_ID);
		if ('error' in reqResult) return;

		await approveRedemption(reqResult.id, 1, TENANT_ID);

		const unshown = await getUnshownRedemptionResult(childId, TENANT_ID);
		expect(unshown).toBeTruthy();
		expect(unshown?.status).toBe('approved');

		// 表示済みにする
		await markRedemptionShown(reqResult.id, TENANT_ID);

		const afterMark = await getUnshownRedemptionResult(childId, TENANT_ID);
		expect(afterMark).toBeNull();
	});
});

describe('expireOldRedemptions', () => {
	it('古い pending 申請が expired になる', async () => {
		const { childId, rewardId } = seedBaseData();
		const reqResult = await requestRedemption(childId, rewardId, TENANT_ID);
		if ('error' in reqResult) return;

		// requestedAt を30日以上前に上書き
		const oldTimestamp = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
		sqlite
			.prepare('UPDATE reward_redemption_requests SET requested_at = ? WHERE id = ?')
			.run(oldTimestamp, reqResult.id);

		const expiredCount = await expireOldRedemptions(TENANT_ID);
		expect(expiredCount).toBeGreaterThanOrEqual(1);

		// ステータスが expired に変わっていることを確認
		const row = sqlite
			.prepare('SELECT status FROM reward_redemption_requests WHERE id = ?')
			.get(reqResult.id) as { status: string };
		expect(row.status).toBe('expired');
	});
});

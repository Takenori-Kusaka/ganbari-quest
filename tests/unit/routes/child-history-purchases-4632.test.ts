// tests/unit/routes/child-history-purchases-4632.test.ts
// #4632: 子供の「記録 > 交換」が「いつ・何を・いくらで交換したか」を出せるようにする。
//
// 顧客に見えていた壊れ方:
//   - ごほうびのタイトル / アイコン / ポイントが出ず、タイトル位置に**申請日**が、
//     アイコンは 🎁 固定で表示されていた (何を交換したか判別できない)
//   - しかもその日付が全件「1月22日（木）」= 1970 年だった。`formatUnixDate(unix)` が
//     `new Date(unix)` で **epoch 秒を ミリ秒として**解釈していたため (elementary / junior で再現)
//
// 修正は 2 点: repo row が snapshot 3 列を返すこと / 秒→JST 暦日 の変換を専用関数に閉じること。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';
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

import { jstDateOfEpochSeconds, toJSTDateString } from '../../../src/lib/domain/date-utils';
import { getRedemptionRequestsForChild } from '../../../src/lib/server/services/reward-redemption-service';

const TENANT = 'test-tenant';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});
afterAll(() => {
	closeDb(sqlite);
});

/** 子供 + ごほうび 1 件を seed し id を返す。 */
function seedChildAndReward(): { childId: number; rewardId: number } {
	resetAllTables(sqlite);
	sqlite
		.prepare("INSERT INTO children (nickname, age, theme, ui_mode) VALUES ('たろう', 8, 'blue', ?)")
		.run('elementary');
	const child = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
	sqlite
		.prepare(
			`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
			 VALUES (?, 'ゲームじかん +30ぷん', 80, '🎮', 'other', CURRENT_TIMESTAMP)`,
		)
		.run(child.id);
	const reward = sqlite.prepare('SELECT id FROM special_rewards LIMIT 1').get() as { id: number };
	return { childId: child.id, rewardId: reward.id };
}

describe('#4632 AC1 交換履歴にごほうびの詳細 (title / icon / points / 個数) が渡る', () => {
	beforeEach(() => {
		resetAllTables(sqlite);
	});

	it('申請時点 snapshot が row に載る (親が改名しても申請時の内容)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
				 VALUES (?, ?, ?, 2, 'approved', 'ゲームじかん +30ぷん', 80, '🎮')`,
			)
			.run(childId, rewardId, Math.floor(Date.now() / 1000));
		// 申請後に親が改名しても、履歴は申請時点の内容を出す
		sqlite.prepare("UPDATE special_rewards SET title = '改名後', points = 999").run();

		const [row] = await getRedemptionRequestsForChild(asChildId(childId), TENANT);
		expect(row?.rewardTitle).toBe('ゲームじかん +30ぷん');
		expect(row?.rewardPoints).toBe(80);
		expect(row?.rewardIcon).toBe('🎮');
		expect(row?.quantity).toBe(2);
	});

	it('snapshot が無い旧行は live reward に fallback する (#2832 以前の行)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status)
				 VALUES (?, ?, ?, 1, 'approved')`,
			)
			.run(childId, rewardId, Math.floor(Date.now() / 1000));

		const [row] = await getRedemptionRequestsForChild(asChildId(childId), TENANT);
		expect(row?.rewardTitle).toBe('ゲームじかん +30ぷん');
		expect(row?.rewardPoints).toBe(80);
		expect(row?.rewardIcon).toBe('🎮');
	});

	it('ごほうびが削除されても行は残り snapshot で読める (#4683 と接続)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
				 VALUES (?, ?, ?, 1, 'approved', 'ゲームじかん +30ぷん', 80, '🎮')`,
			)
			.run(childId, rewardId, Math.floor(Date.now() / 1000));
		sqlite.prepare('DELETE FROM special_rewards WHERE id = ?').run(rewardId);

		const [row] = await getRedemptionRequestsForChild(asChildId(childId), TENANT);
		expect(row, 'ごほうび削除で履歴行が消えている').toBeDefined();
		expect(row?.rewardTitle).toBe('ゲームじかん +30ぷん');
		expect(row?.rewardPoints).toBe(80);
	});
});

describe('#4632 却下 / 期限切れ / 承認待ちの行も snapshot で読める (承認済みだけの機能にしない)', () => {
	beforeEach(() => {
		resetAllTables(sqlite);
	});

	it.each([
		['rejected'],
		['expired'],
		['pending_parent_approval'],
	])('%s の行も title / points / icon を返す', async (status) => {
		const { childId, rewardId } = seedChildAndReward();
		sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
						(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
					 VALUES (?, ?, ?, 1, ?, 'ゲームじかん +30ぷん', 80, '🎮')`,
			)
			.run(childId, rewardId, Math.floor(Date.now() / 1000), status);

		const [row] = await getRedemptionRequestsForChild(asChildId(childId), TENANT);
		expect(row?.status).toBe(status);
		expect(row?.rewardTitle).toBe('ゲームじかん +30ぷん');
		expect(row?.rewardPoints).toBe(80);
	});

	it('status ごとに「ポイントが引かれたか」が判別できる (UI の出し分けの根拠)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		const ins = sqlite.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, ?, 'ゲームじかん +30ぷん', 80, '🎮')`,
		);
		ins.run(childId, rewardId, now, 'approved');
		ins.run(childId, rewardId, now - 10, 'rejected');

		const rows = await getRedemptionRequestsForChild(asChildId(childId), TENANT);
		// 控除が起きたのは approved だけ (finalizeApproval の spendPointsAtomic 1 箇所)。
		// UI はこの status を見て「-80P」を出すか決める (却下行に控除額を出さない)。
		expect(rows.filter((r) => r.status === 'approved')).toHaveLength(1);
		expect(rows.filter((r) => r.status === 'rejected')).toHaveLength(1);
	});
});

describe('#4632 AC2 日付は申請日の JST 暦日 (秒 / ミリ秒の取り違えを起こさない)', () => {
	it('epoch 秒を JST 暦日に変換する (旧実装は秒を ms と解釈し 1970 年になった)', () => {
		// 2026-08-16 12:00:00 JST = 2026-08-16T03:00:00Z
		const epochSeconds = Math.floor(Date.parse('2026-08-16T03:00:00Z') / 1000);
		expect(jstDateOfEpochSeconds(epochSeconds)).toBe('2026-08-16');
		// 旧実装 (秒をそのまま Date へ) は 1970 年になる — この差が実害だった
		expect(toJSTDateString(new Date(epochSeconds))).toMatch(/^1970-/);
	});

	it('JST 日付境界 (00:30 JST = 前日 15:30 UTC) を JST 側の暦日で返す', () => {
		const epochSeconds = Math.floor(Date.parse('2026-08-15T15:30:00Z') / 1000);
		expect(jstDateOfEpochSeconds(epochSeconds)).toBe('2026-08-16');
	});
});

// tests/unit/services/list-limit-misuse-4682.test.ts
// #4682: 「一覧の limit を存在確認 / 集計に流用する」class の回帰テスト (実 SQLite backend)。
//
// 顧客に見えていた壊れ方:
//   F1 申請総数が 50 件を超えると、古い承認待ちを親が承認 / 却下しようとして
//      「申請が見つかりません」になり、子供側は「うけとりまち」のまま固定した
//   F2 台帳が 50 行を超えると `/admin/points` の変換履歴と累計が丸ごと消えた
//      (親が「渡したかどうか」を確認できず、渡し忘れ / 二重払いを起こす)
//   F4 承認待ちが 30 件あると、親の承認履歴が 0 件表示になった

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

import { REDEMPTION_EXPIRE_AFTER_SEC } from '../../../src/lib/server/db/interfaces/reward-redemption-repo.interface';
import { countRedemptionRequestsByTenant } from '../../../src/lib/server/db/reward-redemption-repo';
import { getConvertSummary } from '../../../src/lib/server/services/point-service';
import {
	approveRedemption,
	countPendingRedemptionsForParent,
	expireOldRedemptions,
	getPendingRewardIdsForParent,
	getRedemptionRequestsForParent,
	rejectRedemption,
} from '../../../src/lib/server/services/reward-redemption-service';

const TENANT = 'test-tenant';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});
afterAll(() => {
	closeDb(sqlite);
});

/** 子供 1 人 + ごほうび 1 件を作り、id を返す。 */
function seedChildAndReward(): { childId: number; rewardId: number } {
	resetAllTables(sqlite);
	sqlite
		.prepare("INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, 8, 'blue', ?)")
		.run('たろう', 'elementary');
	const child = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
	sqlite
		.prepare(
			`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
			 VALUES (?, 'ゲームじかん', 80, '🎮', 'other', CURRENT_TIMESTAMP)`,
		)
		.run(child.id);
	const reward = sqlite.prepare('SELECT id FROM special_rewards LIMIT 1').get() as { id: number };
	// 残高を潤沢にしておく (承認時の減算で INSUFFICIENT にしない)
	sqlite
		.prepare(
			"INSERT INTO point_ledger (child_id, amount, type, description) VALUES (?, 100000, 'activity', 'seed')",
		)
		.run(child.id);
	return { childId: child.id, rewardId: reward.id };
}

/** 解決済 (approved) の申請を n 件、新しい順で積む。 */
function seedResolvedRequests(childId: number, rewardId: number, n: number, baseSec: number): void {
	const stmt = sqlite.prepare(
		`INSERT INTO reward_redemption_requests
			(child_id, reward_id, requested_at, quantity, status, resolved_at, reward_title, reward_points, reward_icon)
		 VALUES (?, ?, ?, 1, 'approved', ?, 'ゲームじかん', 80, '🎮')`,
	);
	for (let i = 0; i < n; i++) stmt.run(childId, rewardId, baseSec + i, baseSec + i);
}

describe('#4682 F1: 申請総数が一覧 limit (50) を超えても最古の承認待ちを処理できる', () => {
	it('承認できる (旧実装は「申請が見つかりません」で失敗した)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		// 最古の承認待ちを 1 件作り、その後に新しい解決済を 60 件積む (window から押し出す)
		const oldest = sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
				 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
			)
			.run(childId, rewardId, now - 100_000).lastInsertRowid;
		seedResolvedRequests(childId, rewardId, 60, now - 1000);

		// 一覧 (limit 50) には最古の pending が含まれない = 旧実装が壊れていた条件
		const window = await getRedemptionRequestsForParent(TENANT);
		expect(window.some((r) => r.id === String(oldest))).toBe(false);

		const result = await approveRedemption(String(oldest), 'parent-1', TENANT);
		expect('error' in result, JSON.stringify(result)).toBe(false);

		const row = sqlite
			.prepare('SELECT status FROM reward_redemption_requests WHERE id = ?')
			.get(Number(oldest)) as { status: string };
		expect(row.status).toBe('approved');
	});

	it('却下もできる (承認と対称)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		const oldest = sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
				 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
			)
			.run(childId, rewardId, now - 100_000).lastInsertRowid;
		seedResolvedRequests(childId, rewardId, 60, now - 1000);

		const result = await rejectRedemption(String(oldest), 'いまは だめ', TENANT, 'parent-1');
		expect('error' in result, JSON.stringify(result)).toBe(false);

		const row = sqlite
			.prepare('SELECT status, parent_note FROM reward_redemption_requests WHERE id = ?')
			.get(Number(oldest)) as { status: string; parent_note: string | null };
		expect(row.status).toBe('rejected');
		expect(row.parent_note).toBe('いまは だめ');
	});

	it('承認待ちキューは古い順に取れ、最古が表示 window に必ず入る', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		const oldest = sqlite
			.prepare(
				`INSERT INTO reward_redemption_requests
					(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
				 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
			)
			.run(childId, rewardId, now - 500_000).lastInsertRowid;
		const fill = sqlite.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
		);
		for (let i = 0; i < 60; i++) fill.run(childId, rewardId, now - 1000 + i);

		// 既定 (新しい順 + limit 50) では最古が落ちる = 旧実装が壊れていた条件
		const newestFirst = await getRedemptionRequestsForParent(TENANT, {
			status: 'pending_parent_approval',
		});
		expect(newestFirst.some((r) => r.id === String(oldest))).toBe(false);

		// 古い順なら最古が先頭に来る (親が「一番長く待っている申請」から処理できる)
		const oldestFirst = await getRedemptionRequestsForParent(TENANT, {
			status: 'pending_parent_approval',
			order: 'asc',
			limit: 200,
		});
		expect(oldestFirst[0]?.id).toBe(String(oldest));
		expect(oldestFirst).toHaveLength(61);
	});

	it('承認待ちの件数は COUNT (表示件数ではない) で数える', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		const fill = sqlite.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
		);
		for (let i = 0; i < 61; i++) fill.run(childId, rewardId, now - 1000 + i);

		expect(await countPendingRedemptionsForParent(TENANT), '50 で飽和している').toBe(61);
	});

	it('存在しない id は従来どおり REQUEST_NOT_FOUND (guard を緩めていない)', async () => {
		seedChildAndReward();
		expect(await approveRedemption('999999', 'parent-1', TENANT)).toEqual({
			error: 'REQUEST_NOT_FOUND',
		});
		expect(await rejectRedemption('999999', null, TENANT, 'parent-1')).toEqual({
			error: 'REQUEST_NOT_FOUND',
		});
	});
});

describe('#4682 F4: 承認履歴は「処理済みの直近 N 件」であり、pending に押し出されない', () => {
	it('承認待ちが 40 件あっても処理済みが履歴に出る', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		// 古い処理済み 3 件 → 新しい承認待ち 40 件 (旧実装は「直近 30 申請」を見て履歴 0 件になった)
		seedResolvedRequests(childId, rewardId, 3, now - 100_000);
		const pending = sqlite.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
		);
		for (let i = 0; i < 40; i++) pending.run(childId, rewardId, now - 100 + i);

		const history = await getRedemptionRequestsForParent(TENANT, {
			statuses: ['approved', 'rejected'],
			limit: 30,
		});
		expect(history).toHaveLength(3);
		expect(history.every((r) => r.status === 'approved')).toBe(true);
		// 履歴行は「いつ処理したか」を持つ (UI が処理日時を出せる)
		expect(history.every((r) => r.resolvedAt !== null)).toBe(true);
	});
});

describe('#4682 F2: おこづかい変換の履歴と累計は台帳の行数に依存しない', () => {
	beforeEach(() => {
		resetAllTables(sqlite);
	});

	it('台帳 100 行超でも変換履歴が消えず、累計は DB SUM で正しい', async () => {
		sqlite
			.prepare("INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, 8, 'blue', ?)")
			.run('たろう', 'elementary');
		const child = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };

		// 古い変換 2 件 (計 800pt) → その後に活動記録を 120 行積んで window から押し出す
		const insert = sqlite.prepare(
			'INSERT INTO point_ledger (child_id, amount, type, description, created_at) VALUES (?, ?, ?, ?, ?)',
		);
		insert.run(child.id, -500, 'convert', '変換', '2020-01-01 00:00:00');
		insert.run(child.id, -300, 'convert', '変換', '2020-01-02 00:00:00');
		for (let i = 0; i < 120; i++) {
			insert.run(
				child.id,
				10,
				'activity',
				'記録',
				`2026-01-01 00:${String(i % 60).padStart(2, '0')}:00`,
			);
		}

		const summary = await getConvertSummary(asChildId(child.id), TENANT);
		expect('error' in summary, JSON.stringify(summary)).toBe(false);
		if ('error' in summary) return;

		expect(summary.history, '変換履歴が台帳の行数で消えている').toHaveLength(2);
		expect(summary.history.every((h) => h.type === 'convert')).toBe(true);
		expect(summary.allTimeTotal, '累計が一覧 window に依存している').toBe(800);
	});

	it('今月 / 先月の集計が JST 月境界で切られる (UTC 前方一致だと 9 時間ずれる)', async () => {
		sqlite
			.prepare("INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, 8, 'blue', ?)")
			.run('たろう', 'elementary');
		const child = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
		const insert = sqlite.prepare(
			'INSERT INTO point_ledger (child_id, amount, type, description, created_at) VALUES (?, ?, ?, ?, ?)',
		);

		// 「今月 1 日 00:30 JST」= 前月末 15:30 UTC。UTC 前方一致だと今月から漏れる境界。
		const now = new Date();
		const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
		const monthStartJstUtc = new Date(
			Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), 1, 0, 30) - 9 * 60 * 60 * 1000,
		);
		insert.run(
			child.id,
			-500,
			'convert',
			'変換',
			monthStartJstUtc.toISOString().replace('T', ' ').slice(0, 19),
		);

		const summary = await getConvertSummary(asChildId(child.id), TENANT);
		if ('error' in summary) throw new Error('unexpected NOT_FOUND');
		expect(summary.thisMonthTotal, 'JST 月初 9 時間分が今月から落ちている').toBe(500);
		expect(summary.lastMonthTotal).toBe(0);
	});

	it('変換が 1 件も無ければ履歴も累計も 0 (件数偽装しない)', async () => {
		sqlite
			.prepare("INSERT INTO children (nickname, age, theme, ui_mode) VALUES (?, 8, 'blue', ?)")
			.run('たろう', 'elementary');
		const child = sqlite.prepare('SELECT id FROM children LIMIT 1').get() as { id: number };
		const summary = await getConvertSummary(asChildId(child.id), TENANT);
		if ('error' in summary) throw new Error('unexpected NOT_FOUND');
		expect(summary.history).toHaveLength(0);
		expect(summary.allTimeTotal).toBe(0);
	});
});

describe('#4682 F5: ごほうび管理の承認待ちバッジと種別抽出も一覧 limit に依存しない', () => {
	/** 2 件目のごほうびを足して id を返す。 */
	function addSecondReward(childId: number, title: string): number {
		sqlite
			.prepare(
				`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
				 VALUES (?, ?, 50, '🍭', 'other', CURRENT_TIMESTAMP)`,
			)
			.run(childId, title);
		const row = sqlite.prepare('SELECT id FROM special_rewards ORDER BY id DESC LIMIT 1').get() as {
			id: number;
		};
		return row.id;
	}

	/**
	 * 承認待ちを 61 件積む: 最古 1 件だけ別のごほうび (= 表示 window 50 の外)。
	 * 旧実装 (`getRedemptionRequestsForParent(...).length` / `.map(r => r.rewardId)`) は
	 * ここで件数 50 / 種別 1 件になり、親が処理待ちに気づけなかった。
	 */
	function seedPendingAcrossTwoRewards(): {
		childId: number;
		windowRewardId: number;
		pushedOutRewardId: number;
	} {
		const { childId, rewardId } = seedChildAndReward();
		const pushedOutRewardId = addSecondReward(childId, 'あめ');
		const now = Math.floor(Date.now() / 1000);
		const insert = sqlite.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
		);
		insert.run(childId, pushedOutRewardId, now - 500_000);
		for (let i = 0; i < 60; i++) insert.run(childId, rewardId, now - 1000 + i);
		return { childId, windowRewardId: rewardId, pushedOutRewardId };
	}

	it('バッジ件数は COUNT で数える (51 件以上でも 50 で飽和しない)', async () => {
		seedPendingAcrossTwoRewards();

		// 前置: 表示用一覧 (既定 limit 50) は 50 件で頭打ち = 旧実装が壊れていた条件
		const window = await getRedemptionRequestsForParent(TENANT, {
			status: 'pending_parent_approval',
		});
		expect(window).toHaveLength(50);

		expect(await countPendingRedemptionsForParent(TENANT), '50 で飽和している').toBe(61);
	});

	it('処理待ちのごほうび種別は DISTINCT で取る (window 外のごほうびが抜けない)', async () => {
		const { windowRewardId, pushedOutRewardId } = seedPendingAcrossTwoRewards();

		// 前置: 一覧の map では window 外のごほうびが落ちる
		const window = await getRedemptionRequestsForParent(TENANT, {
			status: 'pending_parent_approval',
		});
		expect([...new Set(window.map((r) => r.rewardId))]).not.toContain(String(pushedOutRewardId));

		const pendingRewardIds = await getPendingRewardIdsForParent(TENANT);
		expect([...pendingRewardIds].sort()).toEqual(
			[String(windowRewardId), String(pushedOutRewardId)].sort(),
		);
	});

	it('承認待ちが 0 件なら種別も空 (存在しないごほうびを処理待ち扱いしない)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		seedResolvedRequests(childId, rewardId, 3, Math.floor(Date.now() / 1000) - 1000);

		expect(await countPendingRedemptionsForParent(TENANT)).toBe(0);
		expect(await getPendingRewardIdsForParent(TENANT)).toEqual([]);
	});
});

describe('#4682 F3: 失効 cron の dry-run は「実際に失効する件数」を返す', () => {
	it('30 日 cutoff より前の承認待ちだけを数える (dry-run の件数 = 実処理の件数)', async () => {
		const { childId, rewardId } = seedChildAndReward();
		const now = Math.floor(Date.now() / 1000);
		const insert = sqlite.prepare(
			`INSERT INTO reward_redemption_requests
				(child_id, reward_id, requested_at, quantity, status, reward_title, reward_points, reward_icon)
			 VALUES (?, ?, ?, 1, 'pending_parent_approval', 'ゲームじかん', 80, '🎮')`,
		);
		// 31 日前 = 失効対象 3 件 / 1 日前 = 対象外 58 件 (合計 61 件で一覧 limit も超える)
		for (let i = 0; i < 3; i++) insert.run(childId, rewardId, now - 31 * 24 * 60 * 60 - i);
		for (let i = 0; i < 58; i++) insert.run(childId, rewardId, now - 24 * 60 * 60 + i);

		// cutoff 無しの COUNT は承認待ち全件 = dry-run の過大報告 (旧実装が返していた値)
		expect(
			await countRedemptionRequestsByTenant(TENANT, { status: 'pending_parent_approval' }),
		).toBe(61);

		const dryRunCount = await countRedemptionRequestsByTenant(TENANT, {
			status: 'pending_parent_approval',
			requestedBeforeEpoch: now - REDEMPTION_EXPIRE_AFTER_SEC,
		});
		expect(dryRunCount, 'dry-run が実際より多く報告している').toBe(3);

		// 同じ母集団であることを実処理の結果で固定する
		expect(await expireOldRedemptions(TENANT)).toBe(dryRunCount);
		expect(await countPendingRedemptionsForParent(TENANT)).toBe(58);
	});
});

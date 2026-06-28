// tests/unit/services/backup-roundtrip-completeness.test.ts
// #3328: backup の export → clear → import (replace) で **全 source 実体**が件数一致で復元されるかを
// 実 SQLite で検証する round-trip 完全性テスト。
//
// 活動だけでなく activityLogs / pointLedger / statuses / statusHistory / loginBonuses / evaluations /
// specialRewards まで全種別を seed し、replace round-trip 後に各種別が復元されることを assert する。
// 未実装の取込 (現状 evaluations は import 関数が無い、#3327) を **赤で機械再現** し、failing-test-first で
// 潰す。新種別を export に足したら本テストへ assert を追加する規律で「silent な取りこぼし」を防ぐ。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
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
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
	findActivityLogs,
	insertActivityLog,
	insertPointLedger,
} from '../../../src/lib/server/db/activity-repo';
import {
	findEvaluationsByChild,
	insertEvaluation,
} from '../../../src/lib/server/db/evaluation-repo';
import { getRepos } from '../../../src/lib/server/db/factory';
import { findRecentBonuses, insertLoginBonus } from '../../../src/lib/server/db/login-bonus-repo';
import { findPointHistory } from '../../../src/lib/server/db/point-repo';
import {
	findRedemptionRequestsByTenant,
	insertRedemptionRequest,
	updateRedemptionRequestStatus,
} from '../../../src/lib/server/db/reward-redemption-repo';
import { getSetting, setSetting } from '../../../src/lib/server/db/settings-repo';
import {
	findSpecialRewards,
	insertSpecialReward,
} from '../../../src/lib/server/db/special-reward-repo';
import {
	findRecentStatusHistory,
	findStatuses,
	insertStatusHistory,
	upsertStatus,
} from '../../../src/lib/server/db/status-repo';
import { getChildActivities } from '../../../src/lib/server/services/activity-service';
import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { exportFamilyData } from '../../../src/lib/server/services/export-service';
import { importFamilyData } from '../../../src/lib/server/services/import-service';

const T = 't-complete';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});
afterAll(() => {
	closeDb(sqlite);
});
beforeEach(() => {
	resetDb(sqlite);
});

describe('#3328 backup round-trip 完全性 — 全 source 実体が export→clear→import で復元される', () => {
	it('活動/ログ/台帳/ステータス/履歴/ログボ/評価/ごほうび が件数一致で復元される', async () => {
		// --- seed: 1 child + 全 source 実体を 1 件ずつ ---
		testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run(); // id=1
		seedChildActivities(testDb, 1, [{ name: 'うんどうA', categoryId: 1, icon: '🏃' }]);
		const seededActs = await getChildActivities(1, T);
		const actId = seededActs[0]?.id as number;

		await insertActivityLog(
			{
				childId: 1,
				activityId: actId,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
				recordedAt: '2026-03-01T08:00:00Z',
			},
			T,
		);
		await insertPointLedger({ childId: 1, amount: 5, type: 'activity', description: 'test' }, T);
		await upsertStatus(1, 1, 50, 3, 50, T);
		await insertStatusHistory(
			{ childId: 1, categoryId: 1, value: 50, changeAmount: 5, changeType: 'activity' },
			T,
		);
		await insertLoginBonus(
			{
				childId: 1,
				loginDate: '2026-03-01',
				rank: 'normal',
				basePoints: 5,
				multiplier: 1,
				totalPoints: 5,
				consecutiveDays: 1,
			},
			T,
		);
		await insertEvaluation(
			{
				childId: 1,
				weekStart: '2026-03-01',
				weekEnd: '2026-03-07',
				scoresJson: '{}',
				bonusPoints: 10,
			},
			T,
		);
		const reward = await insertSpecialReward(
			{
				childId: 1,
				title: 'ごほうびX',
				description: undefined,
				points: 100,
				icon: undefined,
				category: 'money',
				sourcePresetId: null,
			},
			T,
		);

		// #3329: ごほうび交換履歴を 1 件 seed し、承認済 (approved) まで進める。
		// round-trip 後に status=approved と snapshot がそのまま復元されることを検証する。
		const redemption = await insertRedemptionRequest(
			{ childId: 1, rewardId: reward.id, requestedAt: 1_700_000_000_000 },
			T,
		);
		await updateRedemptionRequestStatus(
			1,
			redemption.id,
			{ status: 'approved', resolvedAt: 1_700_000_100_000, resolvedByParentId: 'parent-1' },
			T,
		);

		// #3329: 設定 KVS。allowlist キー (point_unit_mode) + 秘匿キー (pin_hash) を seed し、
		// 秘匿キーが export に載らない (default-deny) こと + allowlist キーが round-trip することを検証。
		await setSetting('point_unit_mode', 'custom', T);
		await setSetting('pin_hash', '$2b$10$fake.hash.not.restored', T);

		// #3329: チャレンジを 1 件 seed し進捗を進める。round-trip 後に currentValue/status が保全されることを検証。
		const challenge = await getRepos().childChallenge.insert(
			{
				childId: 1,
				title: 'うんどうチャレンジ',
				periodType: 'weekly',
				startDate: '2026-03-01',
				endDate: '2026-03-07',
				targetConfig: '{"metric":"count","baseTarget":3}',
				rewardConfig: '{"points":50}',
				targetValue: 3,
			},
			T,
		);
		await getRepos().childChallenge.updateProgress(challenge.id, 2, T);

		// --- export ---
		const data = await exportFamilyData({ tenantId: T });
		// export が全種別を捕捉していること (sanity)
		expect(data.data.childActivities.length, 'export:活動').toBe(1);
		expect(data.data.activityLogs.length, 'export:活動ログ').toBe(1);
		expect(data.data.pointLedger.length, 'export:台帳').toBe(1);
		expect(data.data.evaluations.length, 'export:評価').toBe(1);
		expect(data.data.specialRewards.length, 'export:ごほうび').toBe(1);
		expect(data.data.rewardRedemptions.length, 'export:交換履歴').toBe(1);
		expect(data.data.rewardRedemptions[0]?.status, 'export:交換履歴 status').toBe('approved');
		// #3329: 設定 export — allowlist キーは含み、秘匿キーは構造的に除外 (CWE-522/916)。
		const settingKeys = data.data.settings.map((s) => s.key);
		expect(settingKeys, 'export:設定 allowlist 含む').toContain('point_unit_mode');
		expect(settingKeys, 'export:設定 pin_hash 除外').not.toContain('pin_hash');
		expect(data.data.childChallenges.length, 'export:チャレンジ').toBe(1);
		expect(data.data.childChallenges[0]?.currentValue, 'export:チャレンジ進捗').toBe(2);

		// --- replace = clear → import ---
		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		// --- 復元後の child ---
		const children = testDb.select().from(schema.children).all();
		expect(children.length, '子復元').toBe(1);
		const cid = children[0]?.id as number;

		// --- 全種別の round-trip 件数一致 ---
		expect((await getChildActivities(cid, T)).length, '活動').toBe(1);
		expect((await findActivityLogs(cid, T)).length, '活動ログ').toBe(1);
		expect((await findPointHistory(cid, { limit: 999, offset: 0 }, T)).length, 'ポイント台帳').toBe(
			1,
		);
		expect((await findStatuses(cid, T)).length, 'ステータス').toBeGreaterThanOrEqual(1);
		expect((await findRecentStatusHistory(cid, 1, T, 999)).length, 'ステータス履歴').toBe(1);
		expect((await findRecentBonuses(cid, T, 999)).length, 'ログインボーナス').toBe(1);
		expect((await findEvaluationsByChild(cid, 999, T)).length, '評価').toBe(1);
		expect((await findSpecialRewards(cid, T)).length, 'ごほうび').toBe(1);

		// #3329: 交換履歴が status / snapshot を保って復元される。
		const restoredRedemptions = await findRedemptionRequestsByTenant(T, {
			childId: cid,
			limit: 999,
		});
		expect(restoredRedemptions.length, '交換履歴').toBe(1);
		expect(restoredRedemptions[0]?.status, '交換履歴 status 保全').toBe('approved');
		expect(restoredRedemptions[0]?.rewardTitle, '交換履歴 snapshot 保全').toBe('ごほうびX');

		// #3329: 設定の round-trip — allowlist キーは復元、秘匿キーは clear 後も復元されない。
		expect(await getSetting('point_unit_mode', T), '設定 round-trip').toBe('custom');
		expect(await getSetting('pin_hash', T), '秘匿キー非復元').toBeUndefined();

		// #3329: チャレンジが進捗 (currentValue) を保って復元される。
		const restoredChallenges = await getRepos().childChallenge.findByChildId(cid, T);
		expect(restoredChallenges.length, 'チャレンジ').toBe(1);
		expect(restoredChallenges[0]?.currentValue, 'チャレンジ進捗保全').toBe(2);
		expect(restoredChallenges[0]?.title, 'チャレンジ title 保全').toBe('うんどうチャレンジ');
	});
});

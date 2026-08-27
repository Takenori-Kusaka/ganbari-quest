// tests/unit/services/activity-source-quota-roundtrip.test.ts
// #3669: 活動 source 意味論の producer × consumer round-trip 整合 lock (ADR-0061 same-class guard)
//
// 三重乖離の再現と修正 lock:
//   - producer: UI 手動作成 (`createActivity`) が source を drop → schema default 'seed'
//   - consumer1: `checkActivityLimit` は `'custom'` を集計 → 常に 0 = quota 未執行
//   - consumer2: `/admin/subscription` カウンタは `'parent'` を集計 → 常に 0 表示
//
// 本 test は「UI 作成 → checkActivityLimit.current が +1」の round-trip を実 SQLite で
// 直接 assert する (failing-test-first: 修正前は current=0 で red)。producer 4 経路
// (手動 / marketplace 取込 / seed / 兄弟 copy) の source 値を DB 実体で lock する。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

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

// #2919: resolvePlanTier が debug-plan 経由で $app/environment.dev を参照するため mock
vi.mock('$app/environment', () => ({ dev: false }));

// resolveFullPlanTier が依存する trial-service は本 test の対象外のため固定 mock
vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

import { countsTowardActivityQuota, PARENT_CREATED_SOURCE } from '$lib/domain/activity-source';
import { asCategoryId, asChildId } from '$lib/domain/ids';
import { getRepos } from '$lib/server/db/factory';
import { createActivity, getActivities } from '$lib/server/services/activity-service';
import { copyChildActivitiesToSibling } from '$lib/server/services/child-activity-copy-service';
import { checkActivityLimit } from '$lib/server/services/plan-limit-service';

const TENANT = 't-3669';
// AUTH_MODE=cognito + licenseStatus 'none' → free tier (maxActivities=3)
const FREE_LICENSE = 'none';

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
	// child 2 名 (id=1, 2)
	testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run();
	testDb.insert(schema.children).values({ nickname: 'たくみ', age: 6, theme: 'pink' }).run();
});

function uiCreateInput(name: string) {
	// admin/activities add action と同型の input (UI 手動作成経路)
	return {
		name,
		categoryId: asCategoryId(1),
		icon: '🏃',
		basePoints: 5,
		ageMin: null,
		ageMax: null,
		source: PARENT_CREATED_SOURCE,
	};
}

describe('#3669 activity source round-trip (producer × consumer 整合)', () => {
	it('AC1/AC5: UI 手動作成 (createActivity) → checkActivityLimit.current が +1 される', async () => {
		const before = await checkActivityLimit(TENANT, FREE_LICENSE);
		expect(before.current).toBe(0);

		await createActivity(uiCreateInput('カスタム活動1'), TENANT, asChildId(1));

		const after = await checkActivityLimit(TENANT, FREE_LICENSE);
		expect(after.current).toBe(1);
		expect(after.allowed).toBe(true);
	});

	it("AC1: UI 手動作成した活動は DB に source='custom' で保存される", async () => {
		await createActivity(uiCreateInput('カスタム活動1'), TENANT, asChildId(1));
		const row = sqlite
			.prepare('SELECT source FROM child_activities WHERE name = ?')
			.get('カスタム活動1') as { source: string };
		expect(row.source).toBe('custom');
	});

	it("旧 wire 値 'parent' / source 未指定 (api/v1 経路) も 'custom' に正規化して persist する", async () => {
		await createActivity({ ...uiCreateInput('レガシー'), source: 'parent' }, TENANT, asChildId(1));
		await createActivity({ ...uiCreateInput('未指定'), source: undefined }, TENANT, asChildId(1));
		const rows = sqlite
			.prepare('SELECT name, source FROM child_activities ORDER BY id')
			.all() as Array<{ name: string; source: string }>;
		expect(rows.map((r) => r.source)).toEqual(['custom', 'custom']);
	});

	it('AC2: free プランで custom 活動 3 件作成後、4 件目は allowed=false (quota gate 発動)', async () => {
		await createActivity(uiCreateInput('活動1'), TENANT, asChildId(1));
		await createActivity(uiCreateInput('活動2'), TENANT, asChildId(1));
		await createActivity(uiCreateInput('活動3'), TENANT, asChildId(2));

		const check = await checkActivityLimit(TENANT, FREE_LICENSE);
		expect(check.current).toBe(3);
		expect(check.max).toBe(3);
		expect(check.allowed).toBe(false);
	});

	it('AC3: /admin/subscription カウンタ (同一 SSOT 述語) が実作成数を反映する', async () => {
		await createActivity(uiCreateInput('活動1'), TENANT, asChildId(1));
		await createActivity(uiCreateInput('活動2'), TENANT, asChildId(2));

		// subscription +page.server.ts と同一の集計 (getActivities + countsTowardActivityQuota)
		const acts = await getActivities(TENANT, { includeHidden: false });
		const counted = acts.filter((a) => countsTowardActivityQuota(a.source)).length;
		expect(counted).toBe(2);
	});

	it('AC4: 一括追加経路 (insertActivitiesBulk + PARENT_CREATED_SOURCE) も quota に数えられる', async () => {
		const repos = getRepos();
		await repos.childActivity.insertActivitiesBulk(
			[1, 2].map((cid) => ({
				childId: asChildId(cid),
				name: '一括活動',
				categoryId: asCategoryId(1),
				icon: '📝',
				basePoints: 5,
				source: PARENT_CREATED_SOURCE,
			})),
			TENANT,
		);
		const check = await checkActivityLimit(TENANT, FREE_LICENSE);
		expect(check.current).toBe(2);
	});

	it('AC4: marketplace 取込 / seed 経路 (source 未指定の repo 直 insert) は quota に数えない', async () => {
		const repos = getRepos();
		// marketplace 取込 (activity-import-service) / restore は source 未指定 → schema default 'seed'
		await repos.childActivity.insertActivity(
			{
				childId: asChildId(1),
				name: 'プリセット活動',
				categoryId: asCategoryId(1),
				icon: '🏃',
				basePoints: 5,
				sourcePresetId: 'preset-001',
			},
			TENANT,
		);
		const row = sqlite
			.prepare('SELECT source FROM child_activities WHERE name = ?')
			.get('プリセット活動') as { source: string };
		expect(row.source).toBe('seed');

		const check = await checkActivityLimit(TENANT, FREE_LICENSE);
		expect(check.current).toBe(0);
	});

	it('AC4: 兄弟 copy 経路は元活動の source を保全する (custom の copy は custom のまま数えられる)', async () => {
		await createActivity(uiCreateInput('カスタム活動'), TENANT, asChildId(1));
		// #4694: 兄弟 copy は service 層 (重複 skip 込み) に一本化済。
		await copyChildActivitiesToSibling(TENANT, asChildId(1), asChildId(2));

		const rows = sqlite
			.prepare('SELECT child_id, source FROM child_activities ORDER BY id')
			.all() as Array<{ child_id: number; source: string }>;
		expect(rows).toHaveLength(2);
		expect(rows[1]?.child_id).toBe(2);
		expect(rows[1]?.source).toBe('custom');

		const check = await checkActivityLimit(TENANT, FREE_LICENSE);
		expect(check.current).toBe(2);
	});

	it("SSOT 述語: countsTowardActivityQuota は 'custom' と legacy 'parent' のみ true", () => {
		expect(countsTowardActivityQuota('custom')).toBe(true);
		expect(countsTowardActivityQuota('parent')).toBe(true); // 防御的 forward 互換 (repo 直 write 対策)
		expect(countsTowardActivityQuota('seed')).toBe(false);
		expect(countsTowardActivityQuota('curriculum')).toBe(false);
		expect(countsTowardActivityQuota('pack')).toBe(false);
		expect(countsTowardActivityQuota('marketplace')).toBe(false);
	});
});

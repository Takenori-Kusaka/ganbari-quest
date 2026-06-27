// tests/unit/services/import-service-activity-roundtrip.test.ts
// #3327 / #3328: backup の export → clear → import (replace) round-trip で per-child 活動が
// 復元されるかを実 SQLite で再現する failing-test。
//
// 目的: 本番 incident「replace import で活動 101→0」の**厳密な機序を断定せず再現で確定**する
// (ADR-0061 failing-test-first / 設計 doc §3.0)。本 test が赤になれば「活動喪失」を機械再現し、
// import result (activitiesCreated / warnings) と per-child 分布から原因を観測できる。修正で緑化する。

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

import { getChildActivities } from '../../../src/lib/server/services/activity-service';
import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { exportFamilyData } from '../../../src/lib/server/services/export-service';
import { importFamilyData } from '../../../src/lib/server/services/import-service';

const TENANT = 't-repro';

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

describe('#3327/#3328 backup round-trip: replace で per-child 活動が復元されるか (failing-test 再現)', () => {
	it('2子 + per-child 活動を export → clear → import すると、全活動が各子へ復元される', async () => {
		// --- seed: 2 children + per-child activities (うち 1 件は名前重複で dedup を観測) ---
		testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run(); // id=1
		testDb.insert(schema.children).values({ nickname: 'たくみ', age: 6, theme: 'pink' }).run(); // id=2
		seedChildActivities(testDb, 1, [
			{ name: 'うんどうA', categoryId: 1, icon: '🏃' },
			{ name: 'べんきょうB', categoryId: 2, icon: '📚' },
			{ name: 'せいかつC', categoryId: 3, icon: '🏠' },
		]);
		seedChildActivities(testDb, 2, [
			{ name: 'うんどうA', categoryId: 1, icon: '🏃' }, // child1 と同名（dedup 観測用）
			{ name: 'こうりゅうD', categoryId: 4, icon: '🤝' },
		]);

		const before1 = await getChildActivities(1, TENANT);
		const before2 = await getChildActivities(2, TENANT);
		expect(before1.length, 'seed child1').toBe(3);
		expect(before2.length, 'seed child2').toBe(2);

		// --- export ---
		const data = await exportFamilyData({ tenantId: TENANT });

		// --- replace = clear then import (本番 mode=replace と同型) ---
		await clearAllFamilyData(TENANT);
		const result = await importFamilyData(data, TENANT);

		// --- 復元後の children ---
		const children = testDb.select().from(schema.children).all();
		expect(children.length, 'children restored').toBe(2);

		// --- 各子の活動を集計 ---
		const perChild = await Promise.all(children.map((c) => getChildActivities(c.id, TENANT)));
		const total = perChild.reduce((s, a) => s + a.length, 0);

		// 期待: 子1=3 / 子2=2 / 計5 が per-child に正しく復元される。
		// 失敗時の観測値 (機序確定用): import result + per-child 分布を message に出す。
		const diag = `activitiesCreated=${result.activitiesCreated} warnings=${JSON.stringify(result.warnings)} perChild=${perChild.map((a) => a.length).join(',')}`;
		expect(total, `総活動数 (${diag})`).toBe(5);
		expect(perChild.map((a) => a.length).sort(), `per-child 分布 (${diag})`).toEqual([2, 3]);
	});
});

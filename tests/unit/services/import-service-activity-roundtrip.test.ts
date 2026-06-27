// tests/unit/services/import-service-activity-roundtrip.test.ts
// #3327 / #3328: backup の export → clear → import (replace) round-trip で per-child 活動が
// 復元されるかを実 SQLite で再現する failing-test。
//
// 目的: 本番 incident「replace import で活動 101→0」の**厳密な機序を断定せず再現で確定**する
// (ADR-0061 failing-test-first / 設計 doc §3.0)。本 test が赤になれば「活動喪失」を機械再現し、
// import result (activitiesCreated / warnings) と per-child 分布から原因を観測できる。修正で緑化する。

import { eq } from 'drizzle-orm';
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

	it('兄弟同名活動 + 各々の activityLog を round-trip すると、各ログが正しい子の activity に bind される (cross-child 誤 bind 回帰防止 #3327)', async () => {
		// --- seed: 同名活動「うんどうA」を持つ兄弟 2 人 ---
		testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run(); // id=1
		testDb.insert(schema.children).values({ nickname: 'たくみ', age: 6, theme: 'pink' }).run(); // id=2
		seedChildActivities(testDb, 1, [
			{ name: 'うんどうA', categoryId: 1, icon: '🏃' },
			{ name: 'べんきょうB', categoryId: 2, icon: '📚' },
		]);
		seedChildActivities(testDb, 2, [
			{ name: 'うんどうA', categoryId: 1, icon: '🏃' }, // child1 と同名（cross-child 誤 bind 誘発用）
		]);

		// 各子の「うんどうA」instance は別 id（per-child instance, ADR-0055）
		const a1 = testDb
			.select()
			.from(schema.childActivities)
			.where(eq(schema.childActivities.childId, 1))
			.all()
			.find((a) => a.name === 'うんどうA');
		const a2 = testDb
			.select()
			.from(schema.childActivities)
			.where(eq(schema.childActivities.childId, 2))
			.all()
			.find((a) => a.name === 'うんどうA');
		expect(a1, 'child1 うんどうA seed').toBeDefined();
		expect(a2, 'child2 うんどうA seed').toBeDefined();
		expect(a1?.id, '別 instance であること').not.toBe(a2?.id);

		// --- seed: 各子の「うんどうA」に activityLog を 1 件ずつ ---
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: a1!.id,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-06-01',
				recordedAt: '2026-06-01T09:00:00.000Z',
			})
			.run();
		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 2,
				activityId: a2!.id,
				points: 7,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-06-02',
				recordedAt: '2026-06-02T10:00:00.000Z',
			})
			.run();

		// --- export → clear → import (replace 同型) ---
		const data = await exportFamilyData({ tenantId: TENANT });
		await clearAllFamilyData(TENANT);
		const result = await importFamilyData(data, TENANT);

		// --- 復元後: 各 activityLog が「自分の子の activity」に bind されているか ---
		const logs = testDb.select().from(schema.activityLogs).all();
		const acts = testDb.select().from(schema.childActivities).all();
		const actById = new Map(acts.map((a) => [a.id, a]));

		const diag = `imported=${result.activityLogsImported} skipped=${result.activityLogsSkipped} warnings=${JSON.stringify(result.warnings)}`;
		expect(logs.length, `2 件のログが復元される (${diag})`).toBe(2);

		for (const log of logs) {
			const act = actById.get(log.activityId);
			expect(act, `log.activityId=${log.activityId} の activity が存在 (${diag})`).toBeDefined();
			// 回帰防止の核心: ログが指す activity instance は「ログと同じ子」のもの。
			// name のみ lookup（旧実装）だと兄弟同名活動が縮約され child を跨いで bind され赤になる。
			expect(
				act?.childId,
				`activityLog(child=${log.childId}) は同じ子の activity instance を指す (${diag})`,
			).toBe(log.childId);
			expect(act?.name, 'bind 先 activity 名').toBe('うんどうA');
		}

		// 各子 1 件ずつ復元される（取りこぼし / 重複 bind がない）
		const perChildLogCount = new Map<number, number>();
		for (const log of logs) {
			perChildLogCount.set(log.childId, (perChildLogCount.get(log.childId) ?? 0) + 1);
		}
		expect([...perChildLogCount.values()].sort(), `各子 1 件ずつ (${diag})`).toEqual([1, 1]);
	});
});

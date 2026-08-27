// tests/integration/services/clear-and-replace-with-usage-logs.test.ts
// #4696: 「子供画面を一度でも使った家族」でデータクリア / 置換インポートが壊れる再現と是正。
//
// 実害 (NUC / local sqlite): 子供画面を開くたびに `usage_logs` 行が増えるが、sqlite の deleteChild は
// 同表を消していなかったため children 行の DELETE が FK 制約で失敗し、失敗は warn で握り潰されて
// 画面には「完了しました」と出ていた (children 5→4 / activity_logs 58→58 / 置換インポートでは
// 旧データが残ったまま新データが入り二重化)。
//
//   [C1] usage_logs を持つ子供でも全削除で全表 0 件になる (FK で止まらない)
//   [C2] 子供削除が失敗する状況では「成功」を返さない (ChildDeletionFailedError)
//   [C3] 置換インポートは clear が失敗したら中止し、旧データを保全する

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	closeDb,
	createTestDb,
	resetDb,
	type TestDb,
	type TestSqlite,
} from '../../unit/helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	getOrInitDb() {
		return testDb;
	},
}));
vi.mock('$lib/server/services/child-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../src/lib/server/services/child-service')>()),
	// storage は本 test の対象外 (ファイル削除の失敗は DB 削除を止めない契約)
	deleteChildFiles: vi.fn(async () => {}),
}));
vi.mock('$lib/server/request-context', () => ({
	invalidateRequestCaches: vi.fn(),
}));

const TENANT = 'test-tenant-4696';

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
	vi.clearAllMocks();
});

/** 子供 1 人 + 活動 + 記録 + 「子供画面を開いた」痕跡 (usage_logs) を作る。 */
function seedChildWithUsage(nickname: string): number {
	testDb
		.insert(schema.children)
		.values({ nickname, age: 8, theme: 'blue', uiMode: 'elementary' })
		.run();
	const child = testDb
		.select()
		.from(schema.children)
		.where(eq(schema.children.nickname, nickname))
		.get();
	const childId = child?.id ?? 0;
	testDb
		.insert(schema.childActivities)
		.values({ childId, name: 'はみがき', categoryId: 3, icon: '🦷', basePoints: 5 })
		.run();
	const act = testDb
		.select()
		.from(schema.childActivities)
		.where(eq(schema.childActivities.childId, childId))
		.get();
	testDb
		.insert(schema.activityLogs)
		.values({ childId, activityId: act?.id ?? 0, points: 5, recordedDate: '2026-08-01' })
		.run();
	// 子供画面を開いた記録 (これが FK で children の削除を阻んでいた)
	testDb
		.insert(schema.usageLogs)
		.values({ tenantId: TENANT, childId, startedAt: '2026-08-01T10:00:00.000Z' })
		.run();
	return childId;
}

describe('#4696 usage_logs を持つ家族のデータクリア / 置換インポート', () => {
	it('[C1] usage_logs があっても全削除で children / activity_logs / usage_logs が 0 件になる', async () => {
		seedChildWithUsage('つかった子');
		seedChildWithUsage('つかった子2');
		expect(testDb.select().from(schema.children).all()).toHaveLength(2);
		expect(testDb.select().from(schema.usageLogs).all()).toHaveLength(2);

		const { clearAllFamilyData } = await import('../../../src/lib/server/services/data-service');
		const result = await clearAllFamilyData(TENANT);

		expect(result.deleted.children).toBe(2);
		expect(testDb.select().from(schema.children).all()).toHaveLength(0);
		expect(testDb.select().from(schema.activityLogs).all()).toHaveLength(0);
		expect(testDb.select().from(schema.usageLogs).all()).toHaveLength(0);
	});

	it('[C2] 子供削除に失敗したら成功を返さない (握り潰さない)', async () => {
		const childId = seedChildWithUsage('消せない子');
		// 実際の故障モードと同型: 「children を参照するのに削除対象一覧に無い表」を作って FK で詰まらせる。
		// (#4696 の本番事象では usage_logs がこの役回りだった)
		sqlite.exec(
			`CREATE TABLE zz_unknown_child_ref (id INTEGER PRIMARY KEY AUTOINCREMENT, child_id INTEGER NOT NULL REFERENCES children(id))`,
		);
		sqlite.prepare('INSERT INTO zz_unknown_child_ref (child_id) VALUES (?)').run(childId);

		const { clearAllFamilyData } = await import('../../../src/lib/server/services/data-service');
		const { ChildDeletionFailedError } = await import(
			'../../../src/lib/server/services/tenant-cleanup-service'
		);
		const err = await clearAllFamilyData(TENANT).catch((e) => e);
		sqlite.exec('DROP TABLE zz_unknown_child_ref');

		// 旧実装はここで success (「完了しました」) を返し、子供が残っていることを隠していた
		expect(err).toBeInstanceOf(ChildDeletionFailedError);
		expect(testDb.select().from(schema.children).all()).toHaveLength(1);
		expect(testDb.select().from(schema.children).all()[0]?.id).toBe(childId);
	});

	it('[C3] 置換インポートは clear 失敗時に中止し旧データを保全する (sqlite ROLLBACK)', async () => {
		const childId = seedChildWithUsage('保全される子');
		sqlite.exec(
			`CREATE TABLE zz_unknown_child_ref (id INTEGER PRIMARY KEY AUTOINCREMENT, child_id INTEGER NOT NULL REFERENCES children(id))`,
		);
		sqlite.prepare('INSERT INTO zz_unknown_child_ref (child_id) VALUES (?)').run(childId);

		const { replaceImportAtomic } = await import(
			'../../../src/lib/server/services/replace-import-service'
		);
		const emptyExport = {
			version: '1.0.0',
			exportedAt: '2026-08-20T00:00:00.000Z',
			format: 'ganbari-quest-backup',
			checksum: 'sha256:dummy',
			family: { children: [] },
			master: { activities: [], categories: [] },
			data: {},
		} as unknown as Parameters<typeof replaceImportAtomic>[0];

		const err = await replaceImportAtomic(emptyExport, TENANT).catch((e) => e);
		sqlite.exec('DROP TABLE zz_unknown_child_ref');

		expect(err).toBeInstanceOf(Error);
		// clear が失敗した以上、置換は確定させない (旧データが残る)
		expect(testDb.select().from(schema.children).all()).toHaveLength(1);
		expect(testDb.select().from(schema.activityLogs).all()).toHaveLength(1);
	});
});

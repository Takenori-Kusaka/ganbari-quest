// tests/unit/db/sqlite/checklist-logs-by-child-3078.test.ts
//
// #3078: checklist 完了ログの child 単位バルク取得 (findLogsByChild) を SQLite 実装で固定する。
//   export-service がこのメソッドで per-child progress log を全件取得し、
//   家族データエクスポートの checklistLogs に含める (activityLog の findActivityLogs と対をなす)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestSqlite } from '../../helpers/test-db';

const dbHolder: { sqlite: TestSqlite | null; db: ReturnType<typeof createTestDb>['db'] | null } = {
	sqlite: null,
	db: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

// import after mock
import { checklistLogs, checklistTemplates, children } from '$lib/server/db/schema';
import { findLogsByChild } from '$lib/server/db/sqlite/checklist-repo';

const TENANT = 't-3078';

describe('#3078: SQLite findLogsByChild (child 単位バルク取得)', () => {
	let childId: number;
	let otherChildId: number;
	let templateId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;

		childId = db
			.insert(children)
			.values({ nickname: 'けんた', age: 8, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get().id;
		otherChildId = db
			.insert(children)
			.values({ nickname: 'さくら', age: 6, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get().id;

		templateId = db
			.insert(checklistTemplates)
			.values({ name: 'あさのしたく', icon: '🌅', pointsPerItem: 2, completionBonus: 5 })
			.returning()
			.get().id;
	});

	it('対象 child の完了ログを全件返す', async () => {
		dbHolder.db
			?.insert(checklistLogs)
			.values([
				{
					childId,
					templateId,
					checkedDate: '2026-03-14',
					itemsJson: '{"1":true}',
					completedAll: 1,
					pointsAwarded: 7,
				},
				{
					childId,
					templateId,
					checkedDate: '2026-03-15',
					itemsJson: '{"1":false}',
					completedAll: 0,
					pointsAwarded: 2,
				},
			])
			.run();

		const logs = await findLogsByChild(childId, TENANT);
		expect(logs).toHaveLength(2);
		expect(logs.map((l) => l.checkedDate)).toEqual(['2026-03-15', '2026-03-14']); // checkedDate desc
		expect(logs[0]?.templateId).toBe(templateId);
		expect(logs[0]?.completedAll).toBe(0);
		expect(logs[1]?.pointsAwarded).toBe(7);
	});

	it('他 child のログは含まれない (child 境界)', async () => {
		dbHolder.db
			?.insert(checklistLogs)
			.values([
				{ childId, templateId, checkedDate: '2026-03-15', itemsJson: '{}', pointsAwarded: 1 },
				{
					childId: otherChildId,
					templateId,
					checkedDate: '2026-03-15',
					itemsJson: '{}',
					pointsAwarded: 9,
				},
			])
			.run();

		const logs = await findLogsByChild(childId, TENANT);
		expect(logs).toHaveLength(1);
		expect(logs[0]?.childId).toBe(childId);
		expect(logs[0]?.pointsAwarded).toBe(1);
	});

	it('ログ 0 件なら空配列を返す', async () => {
		const logs = await findLogsByChild(childId, TENANT);
		expect(logs).toEqual([]);
	});
});

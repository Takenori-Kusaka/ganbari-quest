// tests/unit/db/sqlite/per-child-ownership-2845.test.ts
//
// #2845 B1 横展開: SQLite 実装の composite key 所有権検証。
//
// DynamoDB 側 (dynamodb-checklist-repo.test.ts / dynamodb-daily-mission-repo.test.ts /
// dynamodb-cloud-export-repo.test.ts) と同セマンティクスを SQLite 実装 (挙動 SSOT) で固定する:
//   - deleteTemplateItem(templateId, id): templateId 不一致なら affected 0 (no-op)
//   - deleteOverride(childId, id): childId 不一致なら affected 0 (no-op)
//   - markMissionCompleted(childId, date, activityId): 不一致なら affected 0 (no-op)
//   - incrementDownloadCount(id, tenantId): tenantId 不一致なら affected 0 (no-op)

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, seedChildActivities, type TestSqlite } from '../../helpers/test-db';

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
import {
	checklistOverrides,
	checklistTemplateItems,
	checklistTemplates,
	children,
	cloudExports,
	dailyMissions,
} from '$lib/server/db/schema';
import { deleteOverride, deleteTemplateItem } from '$lib/server/db/sqlite/checklist-repo';
import { incrementDownloadCount } from '$lib/server/db/sqlite/cloud-export-repo';
import { markMissionCompleted } from '$lib/server/db/sqlite/daily-mission-repo';

const TENANT = 't-2845';

describe('#2845 B1: SQLite composite key 所有権検証', () => {
	let childId: number;
	let otherChildId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;

		const child1 = db
			.insert(children)
			.values({ nickname: 'けんた', age: 8, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get();
		childId = child1.id;
		const child2 = db
			.insert(children)
			.values({ nickname: 'さくら', age: 6, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get();
		otherChildId = child2.id;
	});

	describe('deleteTemplateItem (templateId 束縛)', () => {
		let templateId: number;
		let itemId: number;

		beforeEach(() => {
			const db = dbHolder.db;
			if (!db) throw new Error('no db');
			const tpl = db
				.insert(checklistTemplates)
				.values({ tenantId: TENANT, name: 'あさの したく' })
				.returning()
				.get();
			templateId = tpl.id;
			const item = db
				.insert(checklistTemplateItems)
				.values({ templateId, name: 'ハンカチ' })
				.returning()
				.get();
			itemId = item.id;
		});

		it('templateId が一致すれば削除される', async () => {
			await deleteTemplateItem(templateId, itemId, TENANT);
			const rest = dbHolder.db
				?.select()
				.from(checklistTemplateItems)
				.where(eq(checklistTemplateItems.id, itemId))
				.all();
			expect(rest).toHaveLength(0);
		});

		it('別 templateId を指定すると no-op (影響 0)', async () => {
			await deleteTemplateItem(templateId + 999, itemId, TENANT);
			const rest = dbHolder.db
				?.select()
				.from(checklistTemplateItems)
				.where(eq(checklistTemplateItems.id, itemId))
				.all();
			expect(rest).toHaveLength(1);
		});
	});

	describe('deleteOverride (childId 束縛)', () => {
		let overrideId: number;

		beforeEach(() => {
			const db = dbHolder.db;
			if (!db) throw new Error('no db');
			const ov = db
				.insert(checklistOverrides)
				.values({ childId, targetDate: '2026-06-12', action: 'add', itemName: 'たいそうふく' })
				.returning()
				.get();
			overrideId = ov.id;
		});

		it('childId が一致すれば削除される', async () => {
			await deleteOverride(childId, overrideId, TENANT);
			const rest = dbHolder.db
				?.select()
				.from(checklistOverrides)
				.where(eq(checklistOverrides.id, overrideId))
				.all();
			expect(rest).toHaveLength(0);
		});

		it('別 childId を指定すると no-op (影響 0)', async () => {
			await deleteOverride(otherChildId, overrideId, TENANT);
			const rest = dbHolder.db
				?.select()
				.from(checklistOverrides)
				.where(eq(checklistOverrides.id, overrideId))
				.all();
			expect(rest).toHaveLength(1);
		});
	});

	describe('markMissionCompleted ((childId, date, activityId) 束縛)', () => {
		let activityId: number;
		const DATE = '2026-06-12';

		beforeEach(() => {
			const db = dbHolder.db;
			if (!db) throw new Error('no db');
			seedChildActivities(db, childId, [{ name: 'たいそうした', categoryId: 1, icon: '🤸' }]);
			const childAct = dbHolder.sqlite
				?.prepare('SELECT id FROM child_activities WHERE child_id = ?')
				.get(childId) as { id: number };
			activityId = childAct.id;
			db.insert(dailyMissions).values({ childId, missionDate: DATE, activityId }).run();
		});

		it('(childId, date, activityId) が一致すれば completed=1 に更新される', async () => {
			await markMissionCompleted(childId, DATE, activityId, TENANT);
			const row = dbHolder.db
				?.select()
				.from(dailyMissions)
				.where(eq(dailyMissions.childId, childId))
				.get();
			expect(row?.completed).toBe(1);
			expect(row?.completedAt).not.toBeNull();
		});

		it('別 childId を指定すると no-op (影響 0)', async () => {
			await markMissionCompleted(otherChildId, DATE, activityId, TENANT);
			const row = dbHolder.db
				?.select()
				.from(dailyMissions)
				.where(eq(dailyMissions.childId, childId))
				.get();
			expect(row?.completed).toBe(0);
		});

		it('別 date を指定すると no-op (影響 0)', async () => {
			await markMissionCompleted(childId, '2026-06-13', activityId, TENANT);
			const row = dbHolder.db
				?.select()
				.from(dailyMissions)
				.where(eq(dailyMissions.childId, childId))
				.get();
			expect(row?.completed).toBe(0);
		});
	});

	describe('incrementDownloadCount (tenantId 束縛)', () => {
		let exportId: number;

		beforeEach(() => {
			const db = dbHolder.db;
			if (!db) throw new Error('no db');
			const rec = db
				.insert(cloudExports)
				.values({
					tenantId: TENANT,
					exportType: 'full',
					pinCode: 'PIN2845',
					s3Key: 'exports/t-2845/PIN2845/data.json',
					fileSizeBytes: 100,
					expiresAt: '2026-12-31T00:00:00.000Z',
				})
				.returning()
				.get();
			exportId = rec.id;
		});

		it('tenantId が一致すれば downloadCount が +1 される', async () => {
			await incrementDownloadCount(exportId, TENANT);
			const row = dbHolder.db
				?.select()
				.from(cloudExports)
				.where(eq(cloudExports.id, exportId))
				.get();
			expect(row?.downloadCount).toBe(1);
		});

		it('別 tenantId を指定すると no-op (影響 0)', async () => {
			await incrementDownloadCount(exportId, 'other-tenant');
			const row = dbHolder.db
				?.select()
				.from(cloudExports)
				.where(eq(cloudExports.id, exportId))
				.get();
			expect(row?.downloadCount).toBe(0);
		});
	});
});

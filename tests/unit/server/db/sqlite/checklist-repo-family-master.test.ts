// tests/unit/server/db/sqlite/checklist-repo-family-master.test.ts
// #2362 PR-5 (ADR-0055): checklist repo family master 化対応のユニットテスト。
//   - findTemplatesByTenant: tenant scope 一覧
//   - findTemplatesByChild: assignments join 経由
//   - assignTemplateToChildren / unassignTemplateFromChildren
//   - deleteTemplate: cascade (assignments / items / logs 同時削除)
//   - NULL is_archived (legacy data 互換) も active 扱いされる (ADR-0031)

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../../../src/lib/server/db/schema';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../../../helpers/test-db';

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
	assignTemplateToChildren,
	deleteTemplate,
	findAssignmentsByChild,
	findAssignmentsByTemplate,
	findTemplateById,
	findTemplatesByChild,
	findTemplatesByTenant,
	insertTemplate,
	unassignTemplate,
	unassignTemplateFromChildren,
	updateTemplate,
	upsertLog,
} from '../../../../../src/lib/server/db/sqlite/checklist-repo';

const TENANT = 'test-tenant';

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

function seedBase() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'たろう', age: 7, theme: 'sky' }).run();
	testDb.insert(schema.children).values({ nickname: 'はなこ', age: 5, theme: 'pink' }).run();
	testDb.insert(schema.children).values({ nickname: 'じろう', age: 9, theme: 'blue' }).run();
}

describe('sqlite/checklist-repo family master (#2362 PR-5)', () => {
	beforeEach(() => {
		seedBase();
	});

	describe('insertTemplate + findTemplatesByTenant', () => {
		it('family master template は childId 列を持たず tenant scope で一覧取得できる', async () => {
			const t1 = await insertTemplate({ name: '家族の決まり', icon: '🏠' }, TENANT);
			await insertTemplate({ name: '習いごとリスト' }, TENANT);

			expect(t1.id).toBeGreaterThan(0);
			expect(t1.tenantId).toBe(TENANT);
			// ChecklistTemplate に childId プロパティはない
			expect((t1 as unknown as { childId?: unknown }).childId).toBeUndefined();

			const list = await findTemplatesByTenant(TENANT);
			expect(list.length).toBe(2);
			expect(list.map((r) => r.name).sort()).toEqual(['家族の決まり', '習いごとリスト']);
		});

		it('別 tenant の template は出ない (tenant isolation)', async () => {
			await insertTemplate({ name: 'tenant-A 専用' }, 'tenant-A');
			await insertTemplate({ name: 'tenant-B 専用' }, 'tenant-B');

			const listA = await findTemplatesByTenant('tenant-A');
			expect(listA.length).toBe(1);
			expect(listA[0]?.name).toBe('tenant-A 専用');
		});
	});

	describe('assignTemplateToChildren + findTemplatesByChild', () => {
		it('1 family checklist を複数 child に配信できる', async () => {
			const tpl = await insertTemplate({ name: '家族リスト' }, TENANT);
			const inserted = await assignTemplateToChildren(tpl.id, [1, 2], TENANT);
			expect(inserted.length).toBe(2);

			const child1List = await findTemplatesByChild(1, TENANT);
			const child2List = await findTemplatesByChild(2, TENANT);
			const child3List = await findTemplatesByChild(3, TENANT);
			expect(child1List.length).toBe(1);
			expect(child2List.length).toBe(1);
			expect(child3List.length).toBe(0);
		});

		it('既配信 child を含む再 assign は重複 row を作らない (冪等)', async () => {
			const tpl = await insertTemplate({ name: '冪等テスト' }, TENANT);
			await assignTemplateToChildren(tpl.id, [1, 2], TENANT);
			const second = await assignTemplateToChildren(tpl.id, [2, 3], TENANT);
			expect(second.length).toBe(1); // child 3 のみ追加
			const all = await findAssignmentsByTemplate(tpl.id, TENANT);
			expect(all.map((a) => a.childId).sort()).toEqual([1, 2, 3]);
		});

		it('childIds 空配列は何も配信しない', async () => {
			const tpl = await insertTemplate({ name: '空配信' }, TENANT);
			const inserted = await assignTemplateToChildren(tpl.id, [], TENANT);
			expect(inserted.length).toBe(0);
		});

		it('isActive=0 の family template は findTemplatesByChild から除外', async () => {
			const tpl = await insertTemplate({ name: '無効化テスト' }, TENANT);
			await assignTemplateToChildren(tpl.id, [1], TENANT);
			await updateTemplate(tpl.id, { isActive: 0 }, TENANT);

			const list = await findTemplatesByChild(1, TENANT);
			expect(list.length).toBe(0);

			const includeInactive = await findTemplatesByChild(1, TENANT, true);
			expect(includeInactive.length).toBe(1);
		});
	});

	describe('unassign', () => {
		it('指定 child 群のみ配信解除', async () => {
			const tpl = await insertTemplate({ name: '解除テスト' }, TENANT);
			await assignTemplateToChildren(tpl.id, [1, 2, 3], TENANT);
			await unassignTemplateFromChildren(tpl.id, [2], TENANT);

			const remaining = await findAssignmentsByTemplate(tpl.id, TENANT);
			expect(remaining.map((a) => a.childId).sort()).toEqual([1, 3]);
		});

		it('unassignTemplate は全配信を解除', async () => {
			const tpl = await insertTemplate({ name: '全解除' }, TENANT);
			await assignTemplateToChildren(tpl.id, [1, 2], TENANT);
			await unassignTemplate(tpl.id, TENANT);

			const remaining = await findAssignmentsByTemplate(tpl.id, TENANT);
			expect(remaining.length).toBe(0);
		});
	});

	describe('findAssignmentsByChild', () => {
		it('child 視点で「配信中の family checklist の id 一覧」を取得できる', async () => {
			const t1 = await insertTemplate({ name: 'A' }, TENANT);
			const t2 = await insertTemplate({ name: 'B' }, TENANT);
			const t3 = await insertTemplate({ name: 'C' }, TENANT);
			await assignTemplateToChildren(t1.id, [1, 2], TENANT);
			await assignTemplateToChildren(t2.id, [1], TENANT);
			await assignTemplateToChildren(t3.id, [2], TENANT);

			const child1Assignments = await findAssignmentsByChild(1, TENANT);
			expect(child1Assignments.map((a) => a.templateId).sort()).toEqual([t1.id, t2.id]);
		});
	});

	describe('deleteTemplate cascade', () => {
		it('template 削除時に assignments / logs / items も同時削除される', async () => {
			const tpl = await insertTemplate({ name: 'cascade' }, TENANT);
			await assignTemplateToChildren(tpl.id, [1], TENANT);

			// log row 作成
			await upsertLog(
				{
					childId: 1,
					templateId: tpl.id,
					checkedDate: '2026-05-25',
					itemsJson: '[]',
					completedAll: 0,
					pointsAwarded: 0,
				},
				TENANT,
			);

			await deleteTemplate(tpl.id, TENANT);

			expect(await findTemplateById(tpl.id, TENANT)).toBeUndefined();
			expect((await findAssignmentsByTemplate(tpl.id, TENANT)).length).toBe(0);
			const logs = testDb
				.select()
				.from(schema.checklistLogs)
				.where(eq(schema.checklistLogs.templateId, tpl.id))
				.all();
			expect(logs.length).toBe(0);
		});
	});

	describe('default is_archived=0 互換 (ADR-0031)', () => {
		it('is_archived default 0 の新規 row は active 扱いされる', async () => {
			// schema 制約上 is_archived は NOT NULL DEFAULT 0。
			// migrate-local.ts (#2362 PR-5) で既存 NULL 行も backfill 済のため、
			// 本 test は schema の default value 動作 + assignments join 後の active 判定を検証する。
			sqlite
				.prepare(
					"INSERT INTO checklist_templates (id, tenant_id, name, icon, points_per_item, completion_bonus, time_slot, is_active) VALUES (?, ?, ?, '📋', 2, 5, 'anytime', 1)",
				)
				.run(999, TENANT, 'archive default check');
			sqlite
				.prepare('INSERT INTO checklist_template_assignments (template_id, child_id) VALUES (?, ?)')
				.run(999, 1);

			const list = await findTemplatesByTenant(TENANT);
			expect(list.map((r) => r.name)).toContain('archive default check');

			const childList = await findTemplatesByChild(1, TENANT);
			expect(childList.map((r) => r.name)).toContain('archive default check');
		});
	});
});

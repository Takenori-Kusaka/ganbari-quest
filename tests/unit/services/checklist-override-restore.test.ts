// tests/unit/services/checklist-override-restore.test.ts
// #3473: checklist 日次 override backup の round-trip 検証 (failing-test-first)。
//
// 検証観点:
//   item1 (demo 非等価): demo backend の insertOverrideForRestore は null / findOverridesByChild は []
//     を返し、「demo でも loss-free に round-trip した」と誤判定されないこと (count 偽装しない)。
//   item3 (restore 入力検証): untrusted backup の enum 外 action / 空 itemName は verbatim 書き戻さず
//     skip + errors に可視化する (silent 破損を作らない)。正常行は createdAt 保全で復元される。

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

import { asChildId } from '$lib/domain/ids';
import { findAllChildren } from '../../../src/lib/server/db/child-repo';
import { getRepos } from '../../../src/lib/server/db/factory';
import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { exportFamilyData } from '../../../src/lib/server/services/export-service';
import { importFamilyData } from '../../../src/lib/server/services/import-service';

const T = 't-ck-override';

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

async function seedOverride() {
	testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run(); // id=1
	await getRepos().checklist.insertOverrideForRestore(
		{
			childId: asChildId(1),
			targetDate: '2026-03-05',
			action: 'add',
			itemName: 'すいとう',
			icon: '📦',
			createdAt: '2026-03-05T09:00:00.000Z',
		},
		T,
	);
}

describe('#3473 checklist override restore (round-trip + 入力検証)', () => {
	it('item3: 正常 override は createdAt 保全で round-trip 復元される', async () => {
		await seedOverride();
		const data = await exportFamilyData({ tenantId: T });
		expect(data.data.checklistOverrides.length).toBe(1);

		await clearAllFamilyData(T);
		const result = await importFamilyData(data, T);

		expect(result.checklistOverridesImported).toBe(1);
		expect(result.checklistOverridesSkipped).toBe(0);

		const children = await findAllChildren(T);
		const child = children.find((c) => c.nickname === 'ゆうき');
		if (!child) throw new Error('restored child not found');
		const overrides = await getRepos().checklist.findOverridesByChild(child.id, T);
		expect(overrides.length).toBe(1);
		expect(overrides[0]?.action).toBe('add');
		expect(overrides[0]?.itemName).toBe('すいとう');
		expect(overrides[0]?.createdAt).toBe('2026-03-05T09:00:00.000Z');
	});

	it('item3: enum 外 action / 空 itemName は skip + errors に可視化し verbatim 書き戻さない', async () => {
		await seedOverride();
		const data = await exportFamilyData({ tenantId: T });
		const valid = data.data.checklistOverrides[0];
		if (!valid) throw new Error('seed override missing');
		// 改竄 backup: enum 外 action + 空 itemName の 2 行を注入
		data.data.checklistOverrides.push({ ...valid, action: 'DROP', targetDate: '2026-03-06' });
		data.data.checklistOverrides.push({ ...valid, itemName: '  ', targetDate: '2026-03-07' });

		await clearAllFamilyData(T);
		const result = await importFamilyData(data, T);

		// 入力 3 = 正常 1 imported + 不正 2 skipped (count 恒等式)
		expect(result.checklistOverridesImported).toBe(1);
		expect(result.checklistOverridesSkipped).toBe(2);
		expect(
			result.checklistOverridesImported + result.checklistOverridesSkipped,
			'count 恒等式',
		).toBe(data.data.checklistOverrides.length);
		// silent skip 禁止: 検証失敗は errors に可視化
		expect(result.errors.some((e) => e.includes('override 検証失敗'))).toBe(true);

		// 実 DB は正常 1 行のみ (enum 外 action は書き戻されない)
		const children = await findAllChildren(T);
		const child = children.find((c) => c.nickname === 'ゆうき');
		if (!child) throw new Error('restored child not found');
		const overrides = await getRepos().checklist.findOverridesByChild(child.id, T);
		expect(overrides.length).toBe(1);
		expect(overrides.every((o) => o.action === 'add' || o.action === 'remove')).toBe(true);
	});
});

// item1: demo backend の null-stub / [] 契約を直接固定する (別 backend、DB 非依存)。
describe('#3473 item1: demo backend override 契約 (loss-free 誤判定防止)', () => {
	it('demo insertOverrideForRestore は null / findOverridesByChild は [] を返す', async () => {
		const demo = await import('../../../src/lib/server/db/demo/checklist-repo');
		const restored = await demo.insertOverrideForRestore(
			{
				childId: asChildId(902),
				targetDate: '2026-03-05',
				action: 'add',
				itemName: 'すいとう',
				icon: '📦',
				createdAt: '2026-03-05T09:00:00.000Z',
			},
			'default',
		);
		// null = 永続化なし → import 側は imported++ しない (count 偽装防止)
		expect(restored).toBeNull();
		const found = await demo.findOverridesByChild(asChildId(902), 'default');
		expect(found).toEqual([]);
	});
});

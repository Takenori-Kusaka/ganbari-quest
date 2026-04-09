// tests/unit/services/default-child-service.test.ts
// #576: default-child-service の getDefaultChildId / setDefaultChildId

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { getDefaultChildId, setDefaultChildId } from '$lib/server/services/default-child-service';

beforeAll(() => {
	const result = createTestDb();
	sqlite = result.sqlite;
	testDb = result.db;
});

afterAll(() => closeDb(sqlite));

beforeEach(() => {
	resetDb(sqlite);
});

describe('#576 default-child-service', () => {
	const tenantId = 'tenant';

	it('未設定のときは null を返す', async () => {
		expect(await getDefaultChildId(tenantId)).toBeNull();
	});

	it('setDefaultChildId(42) → getDefaultChildId() が 42 を返す', async () => {
		await setDefaultChildId(tenantId, 42);
		expect(await getDefaultChildId(tenantId)).toBe(42);
	});

	it('setDefaultChildId(null) で明示クリアできる', async () => {
		await setDefaultChildId(tenantId, 10);
		await setDefaultChildId(tenantId, null);
		expect(await getDefaultChildId(tenantId)).toBeNull();
	});

	it('上書きできる', async () => {
		await setDefaultChildId(tenantId, 1);
		await setDefaultChildId(tenantId, 2);
		expect(await getDefaultChildId(tenantId)).toBe(2);
	});

	it('不正値（0, 負数, NaN 相当）は null として扱う', async () => {
		// setDefaultChildId の型で弾かれるが、DB に直接不正値が残っていた場合の防御
		const { setSetting } = await import('$lib/server/db/settings-repo');
		await setSetting('default_child_id', '0', tenantId);
		expect(await getDefaultChildId(tenantId)).toBeNull();

		await setSetting('default_child_id', '-5', tenantId);
		expect(await getDefaultChildId(tenantId)).toBeNull();

		await setSetting('default_child_id', 'not-a-number', tenantId);
		expect(await getDefaultChildId(tenantId)).toBeNull();
	});
});

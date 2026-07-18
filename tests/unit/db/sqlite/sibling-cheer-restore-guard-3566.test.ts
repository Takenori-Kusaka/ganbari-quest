// tests/unit/db/sqlite/sibling-cheer-restore-guard-3566.test.ts
//
// #3566 ②: SQLite insertForRestore の from/to child ∈ family guard (dangling backup 拒否)。
//
// DSQL 側 (dsql-reward-message-repos.test.ts [SC5]) / DynamoDB 側
// (dynamodb-sibling-cheer-repo.test.ts insertForRestore) と同セマンティクスを SQLite 実装
// (挙動 SSOT) で固定する: restore 入力は untrusted backup 由来のため、from/to child が実在
// (= 同 family に属する) しない場合は 1 行も書かず throw で拒否する。
// guard を外すと dangling 行が入り本 test が fail する検出力を持つ (failing-test-first, ADR-0061)。

import { count } from 'drizzle-orm';
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

import { asChildId } from '$lib/domain/ids';
// import after mock
import { children, siblingCheers } from '$lib/server/db/schema';
import { findAllByTenant, insertForRestore } from '$lib/server/db/sqlite/sibling-cheer-repo';

const TENANT = 't-3566';

describe('#3566 ②: SQLite insertForRestore from/to ∈ family guard', () => {
	let fromChildId: number;
	let toChildId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;

		const c1 = db
			.insert(children)
			.values({ nickname: '応援元', age: 8, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get();
		fromChildId = c1.id;
		const c2 = db
			.insert(children)
			.values({ nickname: '応援先', age: 6, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get();
		toChildId = c2.id;
	});

	const cheerCount = (): number => {
		const db = dbHolder.db;
		if (!db) throw new Error('no db');
		return db.select({ c: count() }).from(siblingCheers).get()?.c ?? 0;
	};

	it('from/to child が実在すれば sentAt/shownAt を verbatim 復元する', async () => {
		const restored = await insertForRestore(
			{
				fromChildId: asChildId(fromChildId),
				toChildId: asChildId(toChildId),
				stampCode: 'restore-ok',
				sentAt: '2025-10-01T09:00:00.000Z',
				shownAt: '2025-10-02T09:00:00.000Z',
			},
			TENANT,
		);
		expect(restored?.fromChildId).toBe(asChildId(fromChildId));
		expect(restored?.toChildId).toBe(asChildId(toChildId));
		expect(restored?.sentAt).toBe('2025-10-01T09:00:00.000Z');
		expect(restored?.shownAt).toBe('2025-10-02T09:00:00.000Z');
		expect(cheerCount()).toBe(1);
		expect((await findAllByTenant(TENANT)).length).toBe(1);
	});

	it('from child が実在しない dangling backup → 拒否 (throw、1 行も書かれない)', async () => {
		await expect(
			insertForRestore(
				{
					fromChildId: asChildId(999999),
					toChildId: asChildId(toChildId),
					stampCode: 'x',
					sentAt: '2025-10-01T09:00:00.000Z',
					shownAt: null,
				},
				TENANT,
			),
		).rejects.toThrow(/not in family/);
		expect(cheerCount()).toBe(0);
	});

	it('to child が実在しない dangling backup → 拒否 (throw、1 行も書かれない)', async () => {
		await expect(
			insertForRestore(
				{
					fromChildId: asChildId(fromChildId),
					toChildId: asChildId(888888),
					stampCode: 'x',
					sentAt: '2025-10-01T09:00:00.000Z',
					shownAt: null,
				},
				TENANT,
			),
		).rejects.toThrow(/not in family/);
		expect(cheerCount()).toBe(0);
	});
});

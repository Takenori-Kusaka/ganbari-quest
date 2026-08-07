// tests/unit/db/sqlite/settings-repo-delete-except-4338.test.ts
//
// #4338: SQLite backend (NUC セルフホスト) 側の `deleteByTenantIdExcept`。
//
// 退会時の孤児 `settings` から認証情報を消す実装は **両 backend に要る**。
// 片方だけだと NUC か cloud のどちらかで「退会したのに `pin_hash` が残る」が生き残る。
// DSQL / PGlite 側の同等検証は `tests/unit/db/dsql-family-satellite-repos.test.ts` [ST4]。
//
// SQLite の `settings` は key 単独 PK のグローバル KVS (単一テナント) であり、
// `deleteByTenantId` が全行削除なのと同じく本メソッドも tenantId を使わない。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, createTestDb, type TestSqlite } from '../../helpers/test-db';

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

const TENANT = 't-4338-sqlite';

// import after mock
import {
	deleteByTenantId,
	deleteByTenantIdExcept,
	getSetting,
	setSetting,
} from '$lib/server/db/sqlite/settings-repo';

/** 現在残っている key を昇順で返す。 */
function remainingKeys(sqlite: TestSqlite): string[] {
	const rows = sqlite.prepare('SELECT key FROM settings ORDER BY key').all() as Array<{
		key: string;
	}>;
	return rows.map((r) => r.key);
}

describe('#4338 sqlite settings-repo: 指定キー以外を全部消す', () => {
	beforeEach(async () => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;

		// 判定 3 キー + 機微キー + 「この test が書いた時点では存在しない」想定の新キー
		await setSetting('soft_deleted_at', '2026-08-01T00:00:00.000Z', TENANT);
		await setSetting('deletion_grace_plan_tier', 'standard', TENANT);
		await setSetting('physical_deletion_date', '2026-08-08T00:00:00.000Z', TENANT);
		await setSetting('pin_hash', '$2b$10$dummy', TENANT);
		await setSetting('session_token', 'sess-dummy', TENANT);
		await setSetting('questionnaire_activity_level', 'high', TENANT);
		await setSetting('deletion_warning_sent_at', '2026-08-07T00:00:00.000Z', TENANT);
		await setSetting('some_future_key_2099', 'x', TENANT);
	});

	afterEach(() => {
		if (dbHolder.sqlite) closeDb(dbHolder.sqlite);
		dbHolder.sqlite = null;
		dbHolder.db = null;
	});

	it('残すと指定した 3 キーだけが残る (機微キーも未知キーも消える)', async () => {
		await deleteByTenantIdExcept(TENANT, [
			'soft_deleted_at',
			'deletion_grace_plan_tier',
			'physical_deletion_date',
		]);

		const sqlite = dbHolder.sqlite;
		if (!sqlite) throw new Error('test db not initialized');
		expect(remainingKeys(sqlite)).toEqual([
			'deletion_grace_plan_tier',
			'physical_deletion_date',
			'soft_deleted_at',
		]);
		// 値は壊れていない (削除の巻き添えで上書きされていない)
		expect(await getSetting('soft_deleted_at', TENANT)).toBe('2026-08-01T00:00:00.000Z');
	});

	it('keepKeys 空は全削除 (deleteByTenantId と同義)', async () => {
		await deleteByTenantIdExcept(TENANT, []);
		const sqlite = dbHolder.sqlite;
		if (!sqlite) throw new Error('test db not initialized');
		expect(remainingKeys(sqlite)).toEqual([]);
	});

	it('deleteByTenantId は従来どおり全削除 (回帰)', async () => {
		await deleteByTenantId(TENANT);
		const sqlite = dbHolder.sqlite;
		if (!sqlite) throw new Error('test db not initialized');
		expect(remainingKeys(sqlite)).toEqual([]);
	});
});

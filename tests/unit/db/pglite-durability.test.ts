// tests/unit/db/pglite-durability.test.ts
// EPIC #3620 AC-C3 (ADR-0064 §検証 gate) — PGlite FS 永続の durability gate + init self-heal。
//
// ADR-0064 は案 C 採択の前提として「PGlite durability を実装時に検証、不合格なら案 A fallback」を
// 定める。本テストは:
//   [C3-1] FS 永続: PGLITE_DATA_DIR に書いた child が close→reopen 後も残る (durability gate)
//          + reopen 後も UTC 既定が catalog に残る (#3629 接続レベル TZ が永続する実証)
//   [C3-2] self-heal: init が reject しても _ready を破棄し、次回 init で自己回復する (#3630 QM follow-up、
//          permanent brick 回避)
// を検証する。env は getEnv() cache を挟むため resetEnvForTesting() で毎回再 parse させる。

import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import {
	getPgliteDbSync,
	getPgliteTransactionRunnerSync,
	initPgliteConnection,
	resetPgliteConnectionForTesting,
} from '../../../src/lib/server/db/pglite/connection';

const FAMILY = '00000000-0000-4000-8000-00000000c3a1';
const tempDirs: string[] = [];

/** 一意な temp dataDir を確保する (afterEach で削除)。Date.now は test 環境で使用可。 */
function freshDataDir(tag: string): string {
	const dir = join(tmpdir(), `pglite-${tag}-${Date.now()}-${tempDirs.length}`);
	tempDirs.push(dir);
	return dir;
}

async function reinitWithEnv(patch: Record<string, string | undefined>): Promise<void> {
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	resetEnvForTesting();
	await resetPgliteConnectionForTesting();
	await initPgliteConnection();
}

describe('PGlite durability gate + self-heal (#3620 AC-C3、ADR-0064 §検証 gate)', () => {
	afterEach(async () => {
		delete process.env.PGLITE_DATA_DIR;
		delete process.env.PGLITE_MIGRATIONS_DIR;
		resetEnvForTesting();
		await resetPgliteConnectionForTesting();
		for (const d of tempDirs.splice(0)) {
			if (existsSync(d)) rmSync(d, { recursive: true, force: true });
		}
	});

	it('[C3-1] FS 永続: close→reopen 後も child が残り、UTC 既定も catalog に永続する', async () => {
		const dataDir = freshDataDir('dur');

		// 1st open: child を書き込む
		await reinitWithEnv({ PGLITE_DATA_DIR: dataDir });
		const repo1 = createDsqlChildRepo(getPgliteDbSync(), getPgliteTransactionRunnerSync());
		const created = await repo1.insertChild(
			{ nickname: '永続くん', age: 8, birthDate: '2018-01-15' },
			FAMILY,
		);

		// close (FS flush) → 同 dataDir で reopen
		await resetPgliteConnectionForTesting();
		await initPgliteConnection();

		// reopen 後も child が残る = durability gate PASS
		const repo2 = createDsqlChildRepo(getPgliteDbSync(), getPgliteTransactionRunnerSync());
		const found = await repo2.findChildById(created.id, FAMILY);
		expect(found?.id).toBe(created.id);
		expect(found?.nickname).toBe('永続くん');

		// reopen 後も UTC 既定が catalog に残る (#3629 接続レベル TZ の永続実証)
		const tz = await getPgliteDbSync().execute(sql`SHOW timezone`);
		expect((tz.rows[0] as { TimeZone?: string }).TimeZone).toBe('UTC');
	});

	it('[C3-2] self-heal: init reject 後も次回 init で自己回復する (permanent brick 回避)', async () => {
		// 存在しない migrations dir を指すと migrate() が throw → init reject
		const bogus = join(tmpdir(), `pglite-missing-migrations-${Date.now()}`);
		await expect(reinitWithEnv({ PGLITE_MIGRATIONS_DIR: bogus })).rejects.toThrow();

		// _ready が破棄されているため、正しい migrations dir で再 init すると成功する
		await reinitWithEnv({ PGLITE_MIGRATIONS_DIR: undefined });
		const repo = createDsqlChildRepo(getPgliteDbSync(), getPgliteTransactionRunnerSync());
		const created = await repo.insertChild({ nickname: '回復くん', age: 8 }, FAMILY);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
	});
});

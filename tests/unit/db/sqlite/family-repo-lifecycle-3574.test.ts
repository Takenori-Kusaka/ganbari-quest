// tests/unit/db/sqlite/family-repo-lifecycle-3574.test.ts
// Issue #3574 (Family repo 実装担保) — SQLite backend parity。
//
// DSQL 側 (tests/unit/db/family-repo-lifecycle-3574.test.ts) と同セマンティクスを SQLite 実装
// (挙動 SSOT、NUC/local backend) で固定する:
//   ① cloud_exports.pin_code / viewer_tokens.token の expire-then-purge 再発行ライフサイクル
//   ② push_subscriptions.findByEndpoint / deleteByEndpoint の §P9 family scope 再適用

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

import { findByPin, insert as insertExport } from '$lib/server/db/sqlite/cloud-export-repo';
// import after mock
import {
	deleteByEndpoint,
	findByEndpoint,
	insert as insertPush,
} from '$lib/server/db/sqlite/push-subscription-repo';
import {
	findByToken,
	insert as insertToken,
	revoke as revokeToken,
} from '$lib/server/db/sqlite/viewer-token-repo';
import type { InsertCloudExportInput } from '$lib/server/db/types';

const FAMILY = 't-3574-a';
const OTHER = 't-3574-b';
const PAST_ISO = '2020-01-01T00:00:00.000Z';
const FUTURE_ISO = '2099-01-01T00:00:00.000Z';

const seedExport = (pin: string, over: Partial<InsertCloudExportInput> = {}) =>
	insertExport({
		tenantId: FAMILY,
		exportType: 'full',
		pinCode: pin,
		s3Key: `exports/${pin}.zip`,
		fileSizeBytes: 0,
		expiresAt: FUTURE_ISO,
		...over,
	});

describe('#3574 SQLite backend parity', () => {
	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;
	});

	// ── ① cloud_exports pin 再発行 ──

	it('[CE①] 期限切れ旧行を占有する pin を再発行できる (expire-then-purge)', async () => {
		const old = await seedExport('910001', { expiresAt: PAST_ISO });
		const fresh = await seedExport('910001', { expiresAt: FUTURE_ISO });
		expect(fresh.id).not.toBe(old.id);
		const resolved = await findByPin('910001');
		expect(resolved?.id).toBe(fresh.id);
		expect(resolved?.expiresAt).toBe(FUTURE_ISO);
	});

	it('[CE①] DL 上限到達旧行を占有する pin も再発行できる', async () => {
		const old = await seedExport('910002', { maxDownloads: 1 });
		dbHolder.sqlite?.exec(`UPDATE cloud_exports SET download_count = 1 WHERE id = ${old.id}`);
		const fresh = await seedExport('910002');
		expect(fresh.id).not.toBe(old.id);
	});

	it('[CE①] live 行が占有する pin の再発行は UNIQUE 衝突で拒否 (2 live 行防止)', async () => {
		await seedExport('910003', { expiresAt: FUTURE_ISO });
		await expect(seedExport('910003', { expiresAt: FUTURE_ISO })).rejects.toThrow();
	});

	it('[CE①] 他 tenant の live 行が占有する pin は奪取不可 (cross-tenant 2 live 行防止)', async () => {
		await seedExport('910004', { tenantId: OTHER, expiresAt: FUTURE_ISO });
		await expect(seedExport('910004', { tenantId: FAMILY })).rejects.toThrow();
	});

	// ── ① viewer_tokens token 再発行 ──

	it('[VT①] revoke 済旧行を占有する token を再発行できる', async () => {
		const old = await insertToken({ token: 'tok-reissue' }, FAMILY);
		await revokeToken(old.id, FAMILY);
		const fresh = await insertToken({ token: 'tok-reissue' }, FAMILY);
		expect(fresh.id).not.toBe(old.id);
		expect((await findByToken('tok-reissue'))?.revokedAt).toBe(null);
	});

	it('[VT①] 期限切れ旧行を占有する token も再発行できる', async () => {
		const old = await insertToken({ token: 'tok-expired', expiresAt: PAST_ISO }, FAMILY);
		const fresh = await insertToken({ token: 'tok-expired', expiresAt: FUTURE_ISO }, FAMILY);
		expect(fresh.id).not.toBe(old.id);
	});

	it('[VT①] live token の再発行は UNIQUE 衝突で拒否', async () => {
		await insertToken({ token: 'tok-live', expiresAt: FUTURE_ISO }, FAMILY);
		await expect(
			insertToken({ token: 'tok-live', expiresAt: FUTURE_ISO }, FAMILY),
		).rejects.toThrow();
	});

	// ── ② push_subscriptions family scope 再適用 ──

	it('[PS②] findByEndpoint は family scope を再適用する', async () => {
		await insertPush({
			tenantId: FAMILY,
			endpoint: 'https://push.example/ep',
			keysP256dh: 'p',
			keysAuth: 'a',
			subscriberRole: 'parent',
		});
		expect((await findByEndpoint('https://push.example/ep', FAMILY))?.tenantId).toBe(FAMILY);
		expect(await findByEndpoint('https://push.example/ep', OTHER)).toBe(undefined);
	});

	it('[PS②] deleteByEndpoint は family 不一致なら no-op', async () => {
		await insertPush({
			tenantId: FAMILY,
			endpoint: 'https://push.example/del',
			keysP256dh: 'p',
			keysAuth: 'a',
			subscriberRole: 'owner',
		});
		await deleteByEndpoint('https://push.example/del', OTHER); // no-op
		expect((await findByEndpoint('https://push.example/del', FAMILY))?.tenantId).toBe(FAMILY);
		await deleteByEndpoint('https://push.example/del', FAMILY); // 所有 family は削除成功
		expect(await findByEndpoint('https://push.example/del', FAMILY)).toBe(undefined);
	});
});

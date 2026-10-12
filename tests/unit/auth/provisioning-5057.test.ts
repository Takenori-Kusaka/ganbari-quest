// tests/unit/auth/provisioning-5057.test.ts
// #5057: 新規 sign-up の初回ログインで `provisionOwnTenant` が必ず失敗していた。
//
// 原因: DSQL の `createTenant` は owner membership を同じ txn で作るのに、`provisionOwnTenant` が
// 直後に `createMembership` で同じ行をもう一度 INSERT し、主キー (family_id, user_id) 重複 (23505)
// で throw → 家族グループはできているのに null を返していた。
//
// mock の repo では「createTenant が membership を作る」契約が再現されないため検出できなかった。
// 実 DDL の PGlite 上の DSQL repo で `provisionOwnTenant` を通しで固定する。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDsqlAuthRepo } from '../../../src/lib/server/db/dsql/auth-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IAuthRepo } from '../../../src/lib/server/db/interfaces/auth-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const h = vi.hoisted(() => ({ repo: undefined as unknown as IAuthRepo }));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: h.repo }),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { provisionOwnTenant } from '../../../src/lib/server/auth/provisioning';

describe('#5057 provisionOwnTenant (実 DDL PGlite)', () => {
	let t: DsqlTestDb;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		h.repo = createDsqlAuthRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});
	beforeEach(() => vi.clearAllMocks());

	it('[P1] 初回: 1 回で成功し owner membership を返す (重複 INSERT で落ちない)', async () => {
		const membership = await provisionOwnTenant('first-login@example.com');

		expect(membership).not.toBeNull();
		expect(membership?.role).toBe('owner');
		const user = await h.repo.findUserByEmail('first-login@example.com');
		const tenants = await h.repo.findUserTenants(user?.userId ?? '');
		expect(tenants).toHaveLength(1);
		expect(tenants[0]?.tenantId).toBe(membership?.tenantId);
	});

	it('[P2] 冪等: 2 回呼んでも家族グループは 1 つ、同じ membership が返る', async () => {
		const first = await provisionOwnTenant('twice@example.com');
		const second = await provisionOwnTenant('twice@example.com');

		expect(second?.tenantId).toBe(first?.tenantId);
		const user = await h.repo.findUserByEmail('twice@example.com');
		expect(await h.repo.findUserTenants(user?.userId ?? '')).toHaveLength(1);
	});
});

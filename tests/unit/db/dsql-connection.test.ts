// tests/unit/db/dsql-connection.test.ts
// EPIC #3424 / M4-B② 接続層 / SSOT: docs/design/dsql/m4-implementation-plan.md §3.3 (F1)
//
// 接続層 (db/dsql/connection.ts) の DoD 検証。実 AWS 不要 — connector (AuroraDSQLPool) と
// drizzle(node-postgres) を mock し、以下を機械検証する:
//   [T1] getDsqlPool: module scope singleton (2 回呼んで同一 pool、connector 構築は 1 回)
//   [T2] getDsqlDb: singleton + drizzle(pool) 集約 (2 回呼んで同一 db、drizzle は 1 回 pool 引数で)
//   [T3] getDsqlTransactionRunner: singleton + drizzle db.transaction を OCC retry で駆動
//   [T4] Drizzle 被せの型/構造整合 (db が execute/transaction を備え SqlExecutor 面を満たす)
//   [T5] DSQL_ENDPOINT 未設定で明示エラー
//   [T6] resolveDbBackend / isDsqlBackend の backend 切替 (SQLite/DSQL/既定)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock は hoist されるため、mock が参照する状態は vi.hoisted 内で定義する。
const { poolCtor, drizzleFn } = vi.hoisted(() => {
	const poolCtor = vi.fn();
	const drizzleFn = vi.fn((pool: unknown) => ({
		__pool: pool,
		execute: vi.fn(async () => ({ rows: [] })),
		transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
			work({ execute: vi.fn(async () => ({ rows: [] })) }),
		),
	}));
	return { poolCtor, drizzleFn };
});

// ── connector mock: AuroraDSQLPool 構築回数と config を記録する fake pool ──
vi.mock('@aws/aurora-dsql-node-postgres-connector', () => {
	class FakeAuroraDSQLPool {
		config: unknown;
		end = vi.fn(async () => {});
		constructor(config: unknown) {
			this.config = config;
			poolCtor(config);
		}
	}
	return { AuroraDSQLPool: FakeAuroraDSQLPool };
});

// ── drizzle(node-postgres) mock: pool を受け取り fake db を返す ──
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: drizzleFn }));

import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import { isDsqlBackend, resolveDbBackend } from '../../../src/lib/server/db/backend';
import {
	getDsqlDb,
	getDsqlPool,
	getDsqlTransactionRunner,
	resetDsqlConnectionForTesting,
} from '../../../src/lib/server/db/dsql/connection';

describe('dsql/connection 接続層 (M4-B②、§3.3)', () => {
	beforeEach(() => {
		process.env.DSQL_ENDPOINT = 'testcluster.dsql.us-east-1.on.aws';
		resetEnvForTesting();
		poolCtor.mockClear();
		drizzleFn.mockClear();
	});

	afterEach(async () => {
		await resetDsqlConnectionForTesting();
		delete process.env.DSQL_ENDPOINT;
		resetEnvForTesting();
		delete process.env.DSQL_USER;
		resetEnvForTesting();
		delete process.env.DSQL_DATABASE;
		resetEnvForTesting();
	});

	it('[T1] getDsqlPool は module scope singleton (2 回呼んで同一 pool、connector 構築は 1 回)', () => {
		const a = getDsqlPool();
		const b = getDsqlPool();
		expect(a).toBe(b);
		expect(poolCtor).toHaveBeenCalledTimes(1);
	});

	it('[T1b] pool config: endpoint=host / 既定 user=admin / database=postgres / ssl / region 非指定 (connector 自動判定)', () => {
		delete process.env.DSQL_USER;
		getDsqlPool();
		expect(poolCtor).toHaveBeenCalledWith(
			expect.objectContaining({
				host: 'testcluster.dsql.us-east-1.on.aws',
				user: 'admin',
				database: 'postgres',
				ssl: true,
			}),
		);
		const cfg = poolCtor.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(cfg).not.toHaveProperty('region');
	});

	it('[T2] getDsqlDb は singleton + drizzle(pool) を 1 箇所集約 (2 回で同一 db、drizzle は pool 引数で 1 回)', () => {
		const d1 = getDsqlDb();
		const d2 = getDsqlDb();
		expect(d1).toBe(d2);
		expect(drizzleFn).toHaveBeenCalledTimes(1);
		// drizzle は connector pool を受け取る (無改変被せ)
		expect(drizzleFn.mock.calls[0]?.[0]).toBe(getDsqlPool());
	});

	it('[T3] getDsqlTransactionRunner は singleton + drizzle db.transaction を駆動する', async () => {
		const runner = getDsqlTransactionRunner();
		expect(getDsqlTransactionRunner()).toBe(runner);
		const result = await runner.runInTransaction(async (tx) => {
			// tx は SqlExecutor 面 (execute) を備える
			expect(typeof (tx as { execute: unknown }).execute).toBe('function');
			return 42;
		});
		expect(result).toBe(42);
		// drizzle db の transaction が呼ばれた
		const db = getDsqlDb() as unknown as { transaction: ReturnType<typeof vi.fn> };
		expect(db.transaction).toHaveBeenCalled();
	});

	it('[T4] Drizzle 被せの構造整合: db は execute / transaction を備える (SqlExecutor 契約)', () => {
		const db = getDsqlDb() as unknown as Record<string, unknown>;
		expect(typeof db.execute).toBe('function');
		expect(typeof db.transaction).toBe('function');
	});

	it('[T5] DSQL_ENDPOINT 未設定は明示エラー (silent fallback しない)', () => {
		delete process.env.DSQL_ENDPOINT;
		resetEnvForTesting();
		expect(() => getDsqlPool()).toThrow(/DSQL_ENDPOINT/);
	});
});

describe('backend 切替 (resolveDbBackend / isDsqlBackend)', () => {
	it('[T6] DATA_SOURCE 明示引数で SQLite / DSQL / demo を解決', () => {
		expect(resolveDbBackend('sqlite')).toBe('sqlite');
		expect(resolveDbBackend('dsql')).toBe('dsql');
		expect(resolveDbBackend('demo')).toBe('demo');
		// 未知値 / 未設定は既存挙動どおり sqlite 既定。#3438 で撤去した 'dynamodb' も既定にフォールバック。
		expect(resolveDbBackend('dynamodb')).toBe('sqlite');
		expect(resolveDbBackend(undefined)).toBe('sqlite');
		expect(resolveDbBackend('unknown')).toBe('sqlite');
	});

	it('[T6b] isDsqlBackend は dsql のときだけ true', () => {
		expect(isDsqlBackend('dsql')).toBe(true);
		expect(isDsqlBackend('sqlite')).toBe(false);
		expect(isDsqlBackend('demo')).toBe(false);
	});
});

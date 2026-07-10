// src/lib/server/db/dsql/migration/provision.ts
// EPIC #3424 M5 (DoD 2) — 生成済み migration (drizzle/pglite/) を DSQL cluster へ適用する
// provisioning orchestration。runner.ts (autocommit 適用 + ASYNC poll) の上位層として、
// journal 順の tag 列挙 / applied 管理 (dsql_migrations 表) / 冪等 skip を担う。
//
// 設計判断:
//   - **migration SQL の SSOT は drizzle/pglite/** (dsql/schema.ts から drizzle-kit generate)。
//     PGlite (NUC) と DSQL (cloud) は同一 pg-core schema のため生成物を共有し、DSQL 固有の
//     方言差 (CREATE INDEX ASYNC / 1txn1DDL) は transform.ts が吸収する (二重生成しない)。
//   - **applied 管理は tag 単位** (dsql_migrations 表、drizzle 標準 __drizzle_migrations と
//     同思想)。statement 単位 resume は持たない: EPIC #3424 は「ゼロユーザー期に DSQL へ
//     作り直す」前提で、部分失敗時は cluster 内の対象 schema を落として再適用が最も安全・単純
//     (Pre-PMF、ADR-0010)。この制約は CLI (--help) にも明示する。
//   - executor は RawSqlExecutor (runner と同じ最小面) を注入: 実 DSQL (AuroraDSQLPool) でも
//     テスト (PGlite / fake) でも同じ経路を検証できる。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawSqlExecutor } from './async-index-poll';
import { type ApplyMigrationOptions, runDsqlMigration } from './runner';
import type { DsqlMigrationPlan } from './transform';

/** drizzle-kit journal (meta/_journal.json) の最小形状。 */
interface DrizzleJournal {
	entries: { idx: number; tag: string }[];
}

export interface MigrationFile {
	tag: string;
	sqlText: string;
}

/** journal 順 (idx 昇順) に migration SQL を読み込む。 */
export function loadMigrationFiles(migrationsDir: string): MigrationFile[] {
	const journal = JSON.parse(
		readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf-8'),
	) as DrizzleJournal;
	return [...journal.entries]
		.sort((a, b) => a.idx - b.idx)
		.map((e) => ({
			tag: e.tag,
			sqlText: readFileSync(join(migrationsDir, `${e.tag}.sql`), 'utf-8'),
		}));
}

/** applied 管理表。tag 単位の冪等 skip に使う (statement 単位 resume は持たない — 上記設計判断)。 */
const APPLIED_TABLE_DDL = `CREATE TABLE IF NOT EXISTS dsql_migrations (
	tag text PRIMARY KEY,
	applied_at timestamptz NOT NULL DEFAULT now()
)`;

/** 適用済み tag 集合を取得する (管理表が無ければ作る)。 */
export async function fetchAppliedTags(executor: RawSqlExecutor): Promise<Set<string>> {
	await executor.execute(APPLIED_TABLE_DDL);
	const res = await executor.execute('SELECT tag FROM dsql_migrations');
	return new Set((res.rows as { tag: string }[]).map((r) => r.tag));
}

export interface ProvisionResult {
	applied: { tag: string; plan: DsqlMigrationPlan }[];
	skipped: string[];
}

/**
 * 生成済み migration を journal 順に DSQL へ適用する (tag 単位冪等)。
 * 各 tag: transform → autocommit 1 文ずつ適用 (+ ASYNC index poll) → 成功後に applied 記録。
 * 途中失敗はその tag が未記録のまま throw する (再実行時は同 tag 先頭から。部分適用が残る場合は
 * ゼロユーザー期のため schema を落として再適用が運用手順 — CLI help に明示)。
 */
export async function provisionDsqlSchema(
	migrationsDir: string,
	executor: RawSqlExecutor,
	opts: ApplyMigrationOptions = {},
): Promise<ProvisionResult> {
	const files = loadMigrationFiles(migrationsDir);
	const appliedTags = await fetchAppliedTags(executor);
	const result: ProvisionResult = { applied: [], skipped: [] };
	for (const file of files) {
		if (appliedTags.has(file.tag)) {
			result.skipped.push(file.tag);
			continue;
		}
		const plan = await runDsqlMigration(file.sqlText, executor, opts);
		// 成功した tag のみ記録 (INSERT 自体も autocommit 単文)。
		await executor.execute(
			`INSERT INTO dsql_migrations (tag) VALUES ('${file.tag.replace(/'/g, "''")}')`,
		);
		result.applied.push({ tag: file.tag, plan });
	}
	return result;
}

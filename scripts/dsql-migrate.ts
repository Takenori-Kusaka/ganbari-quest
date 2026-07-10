// scripts/dsql-migrate.ts — DSQL cluster への schema provisioning CLI (EPIC #3424 M5 DoD 2)
//
// 生成済み migration (drizzle/pglite/、dsql/schema.ts の drizzle-kit generate 出力) を
// transform (DSQL 方言変換) → autocommit 適用 → ASYNC index poll の経路で DSQL cluster に
// 適用する。core logic は src/lib/server/db/dsql/migration/provision.ts (unit test 済) に集約し、
// 本 CLI は接続確立 + 引数処理のみの thin wrapper (使い捨て script ではない恒久運用ツール #1442)。
//
// 実行 (tsx、DbConnectAdmin 相当の AWS credential が必要):
//   DSQL_ENDPOINT=<id>.dsql.<region>.on.aws npm run dsql:migrate            # 適用
//   DSQL_ENDPOINT=... npm run dsql:migrate -- --dry-run                     # plan 表示のみ
//
// ⚠️ 運用制約 (provision.ts 設計判断): applied 管理は tag 単位。tag 途中で失敗した場合、
//    その tag は未記録のまま = 再実行は同 tag 先頭から適用し既存 object と衝突し得る。
//    ゼロユーザー期 (EPIC #3424 前提) は対象 schema を落として再適用が最も安全:
//      DROP TABLE 全表 (または cluster 再作成) → 本 CLI 再実行
//
// migration 経路の credential は実行時アプリ (dsql:DbConnect) と分離された DbConnectAdmin
// (M3 §3.4 B6)。deploy workflow への組込は staging DSQL 経路 (EPIC #3424 DoD 4) で行う。

import { resolve } from 'node:path';
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import type { RawSqlExecutor } from '../src/lib/server/db/dsql/migration/async-index-poll';
import {
	loadMigrationFiles,
	provisionDsqlSchema,
} from '../src/lib/server/db/dsql/migration/provision';
import { transformDrizzleSqlToDsql } from '../src/lib/server/db/dsql/migration/transform';

const dryRun = process.argv.includes('--dry-run');
const migrationsDir =
	process.env.DSQL_MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle', 'pglite');

async function main(): Promise<void> {
	if (dryRun) {
		// 接続不要: transform 結果 (DDL 文数 / ASYNC index) を表示して終了。
		for (const file of loadMigrationFiles(migrationsDir)) {
			const plan = transformDrizzleSqlToDsql(file.sqlText);
			const asyncCount = plan.ddl.filter((s) => s.asyncIndexName).length;
			console.log(`[dry-run] ${file.tag}: ddl=${plan.ddl.length} 文 (ASYNC index=${asyncCount})`);
		}
		return;
	}

	const endpoint = process.env.DSQL_ENDPOINT;
	if (!endpoint) {
		console.error(
			'[dsql-migrate] DSQL_ENDPOINT が未設定です。DsqlStack の ClusterEndpoint 出力を設定してください。',
		);
		process.exit(1);
	}

	// migration は DbConnectAdmin 経路 (admin role)。実行時アプリの DbConnect とは分離 (M3 §3.4 B6)。
	const pool = new AuroraDSQLPool({
		host: endpoint,
		user: process.env.DSQL_MIGRATE_USER ?? 'admin',
		database: process.env.DSQL_DATABASE ?? 'postgres',
		ssl: true,
	});
	const executor: RawSqlExecutor = {
		execute: async (sqlText: string) => {
			const res = await pool.query(sqlText);
			return { rows: (res as { rows?: unknown[] }).rows ?? [] };
		},
	};

	try {
		const result = await provisionDsqlSchema(migrationsDir, executor);
		for (const s of result.skipped) console.log(`[skip] ${s} (適用済み)`);
		for (const a of result.applied) console.log(`[applied] ${a.tag} (ddl=${a.plan.ddl.length} 文)`);
		console.log(
			`[dsql-migrate] 完了: applied=${result.applied.length} / skipped=${result.skipped.length}`,
		);
	} finally {
		await (pool as unknown as { end(): Promise<void> }).end();
	}
}

main().catch((err) => {
	console.error('[dsql-migrate] 失敗:', err);
	process.exit(1);
});

// scripts/dsql-grant.ts — DSQL アプリ実行 role (app_user) の provisioning CLI (EPIC #3424 M5 / #3646)
//
// Lambda 実行 role は IAM action `dsql:DbConnect` のみ持つ (compute-stack #3637、M3 §3.4 B6
// 最小権限)。DSQL の認可仕様では DbConnect は custom database role 専用のため、本 CLI が
// role 作成 + AWS IAM GRANT (Lambda role ARN 紐付け) + 表 GRANT (UPDATE 除外表は
// SELECT/INSERT/DELETE のみ) を冪等に適用する。core logic は
// src/lib/server/db/dsql/migration/app-role.ts (unit test 済) に集約し、本 CLI は接続確立 +
// 引数処理のみの thin wrapper (使い捨て script ではない恒久運用ツール #1442)。
//
// 実行 (tsx、DbConnectAdmin 相当の AWS credential が必要。dsql-migrate と同経路):
//   DSQL_ENDPOINT=<id>.dsql.<region>.on.aws npm run dsql:grant -- --iam-role-arn arn:aws:iam::<acct>:role/<lambda-role>
//   DSQL_ENDPOINT=... npm run dsql:grant                # role + 表 GRANT のみ (IAM 紐付けなし)
//
// deploy workflow では compute-stack deploy 後 (Lambda 実行 role ARN 確定後) に実行する。
// migration (dsql:migrate) が先、grant が後 — 表 GRANT は information_schema の実在表に
// 対して行うため。

import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { provisionAppRole } from '../src/lib/server/db/dsql/migration/app-role';
import type { RawSqlExecutor } from '../src/lib/server/db/dsql/migration/async-index-poll';

function readArg(name: string): string | undefined {
	const idx = process.argv.indexOf(name);
	if (idx >= 0) return process.argv[idx + 1];
	const eq = process.argv.find((a) => a.startsWith(`${name}=`));
	return eq?.slice(name.length + 1);
}

async function main(): Promise<void> {
	const endpoint = process.env.DSQL_ENDPOINT;
	if (!endpoint) {
		console.error(
			'[dsql-grant] DSQL_ENDPOINT が未設定です。DsqlStack の ClusterEndpoint 出力を設定してください。',
		);
		process.exit(1);
	}
	const iamRoleArn = readArg('--iam-role-arn');

	// grant は DbConnectAdmin 経路 (admin role)。実行時アプリの DbConnect とは分離 (M3 §3.4 B6)。
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
		const result = await provisionAppRole(executor, { iamRoleArn });
		console.log(
			`[dsql-grant] role=${result.roleName} (created=${result.roleCreated}) iamGranted=${result.iamGranted}`,
		);
		for (const g of result.granted) console.log(`[grant] ${g.table}: ${g.privileges}`);
		console.log(`[dsql-grant] 完了: ${result.granted.length} 表に GRANT 適用`);
	} finally {
		await (pool as unknown as { end(): Promise<void> }).end();
	}
}

main().catch((err) => {
	console.error('[dsql-grant] 失敗:', err);
	process.exit(1);
});

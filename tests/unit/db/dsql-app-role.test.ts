// tests/unit/db/dsql-app-role.test.ts
// #3646 / EPIC #3424 M5 — アプリ実行 role provisioning (app-role.ts) の契約テスト。
//
// 実 schema PGlite (実 Postgres WASM) で provisionAppRole を実行し:
//   [G1] role 作成 + 表 GRANT が通る (冪等: 2 回目も成功)
//   [G2] UPDATE 除外表 (point_ledger 等) は UPDATE 権限が付与されない = 台帳改竄の物理防御
//        (M3 §3.4、has_table_privilege で DB 実権限を assert)
//   [G3] 通常表 (children 等) は SELECT/INSERT/UPDATE/DELETE 全付与
//   [G4] DELETE は UPDATE 除外表にも付与される (退会 / retention ADR-0049 の正当経路)
//   [G5] AWS IAM GRANT (DSQL 固有構文、PGlite 非対応) は fake executor で SQL 文字列 + 冪等
//        スキップを検証
//   [G6] roleName / iamRoleArn の形式検証 (raw SQL 埋め込みの injection 防御)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	APP_ROLE_NAME,
	provisionAppRole,
	UPDATE_EXCLUDED_TABLES,
} from '../../../src/lib/server/db/dsql/migration/app-role';
import type { RawSqlExecutor } from '../../../src/lib/server/db/dsql/migration/async-index-poll';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const ARN = 'arn:aws:iam::443370718249:role/staging-lambda-role';

describe('DSQL app role provisioning (#3646、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let executor: RawSqlExecutor;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		executor = {
			execute: async (sqlText: string) => {
				const res = await t.client.query(sqlText);
				return { rows: (res.rows ?? []) as unknown[] };
			},
		};
	}, 120_000);
	afterAll(async () => {
		await t.close();
	});

	async function privilege(table: string, priv: string): Promise<boolean> {
		const res = await t.client.query(
			`SELECT has_table_privilege('${APP_ROLE_NAME}', '${table}', '${priv}') AS ok`,
		);
		return (res.rows[0] as { ok: boolean }).ok;
	}

	it('[G1] role 作成 + 表 GRANT が通り、冪等 (2 回目は roleCreated=false で成功)', async () => {
		const first = await provisionAppRole(executor);
		expect(first.roleName).toBe(APP_ROLE_NAME);
		expect(first.roleCreated).toBe(true);
		expect(first.granted.length).toBeGreaterThan(50); // 実 schema 全表 (59 表) に適用
		const second = await provisionAppRole(executor);
		expect(second.roleCreated).toBe(false);
		expect(second.granted.length).toBe(first.granted.length);
	}, 120_000);

	it('[G2] UPDATE 除外表は UPDATE 権限が付与されない (台帳改竄の物理防御、M3 §3.4)', async () => {
		for (const table of UPDATE_EXCLUDED_TABLES) {
			expect(await privilege(table, 'UPDATE'), `${table} に UPDATE が付与されている`).toBe(false);
			expect(await privilege(table, 'SELECT'), `${table} に SELECT が無い`).toBe(true);
			expect(await privilege(table, 'INSERT'), `${table} に INSERT が無い`).toBe(true);
		}
	}, 60_000);

	it('[G3] 通常表 (children / activity_logs / trial_history) は UPDATE 込み全権付与', async () => {
		// activity_logs (cancelled soft-cancel) / trial_history (状態更新) は実装が UPDATE を
		// 発行するため除外リスト外であること自体も本 assert が固定する。
		for (const table of ['children', 'activity_logs', 'trial_history']) {
			for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
				expect(await privilege(table, priv), `${table} に ${priv} が無い`).toBe(true);
			}
		}
	}, 60_000);

	it('[G4] DELETE は UPDATE 除外表にも付与される (退会 / retention ADR-0049 の正当経路)', async () => {
		for (const table of ['point_ledger', 'consents', 'graduation_consent']) {
			expect(await privilege(table, 'DELETE'), `${table} に DELETE が無い`).toBe(true);
		}
	}, 60_000);

	it('[G5] AWS IAM GRANT: fake executor で SQL 文字列を検証し、mapping 既存時はスキップ', async () => {
		const executed: string[] = [];
		const fake = (mapped: boolean): RawSqlExecutor => ({
			execute: async (sqlText: string) => {
				executed.push(sqlText);
				if (sqlText.includes('pg_roles')) return { rows: [{ ok: 1 }] }; // role 既存
				if (sqlText.includes('iam_pg_role_mappings')) return { rows: mapped ? [{ ok: 1 }] : [] };
				if (sqlText.includes('information_schema.tables')) return { rows: [] };
				return { rows: [] };
			},
		});

		// mapping 不在 → AWS IAM GRANT が発行される
		const r1 = await provisionAppRole(fake(false), { iamRoleArn: ARN });
		expect(r1.iamGranted).toBe(true);
		expect(executed).toContain(`AWS IAM GRANT ${APP_ROLE_NAME} TO '${ARN}'`);

		// mapping 既存 → スキップ (冪等)
		executed.length = 0;
		const r2 = await provisionAppRole(fake(true), { iamRoleArn: ARN });
		expect(r2.iamGranted).toBe(false);
		expect(executed.some((s) => s.startsWith('AWS IAM GRANT'))).toBe(false);
	});

	it('[G6] roleName / iamRoleArn の形式検証 (raw SQL injection 防御)', async () => {
		await expect(
			provisionAppRole(executor, { roleName: 'x; DROP TABLE children;--' }),
		).rejects.toThrow(/identifier/);
		await expect(
			provisionAppRole(executor, { iamRoleArn: "arn:aws:iam::123:role/x' ; DROP TABLE y;--" }),
		).rejects.toThrow(/ARN/);
	});
});

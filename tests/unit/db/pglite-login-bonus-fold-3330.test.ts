// tests/unit/db/pglite-login-bonus-fold-3330.test.ts
// #3330 (案 B counter 縮約) — pg 側 migration (drizzle/pglite/0004) の fold 導出正当性。
//
// 0004_drop_login_bonuses.sql の実 SQL (gaps-and-islands fold INSERT + DROP) を、
// 旧 login_bonuses (0000 時点の DDL) を seed した PGlite に対して statement 単位で実行し、
// per-date fixture → counter 期待値 (deriveStreakCounter と同一結果) を検証する。
// sqlite 側の同検証は tests/unit/db/lazy-startup-migrations.test.ts (#3330 block)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FAMILY_A = '00000000-0000-4000-8000-0000000000f1';
const FAMILY_B = '00000000-0000-4000-8000-0000000000f2';
const CHILD_1 = '00000000-0000-4000-8000-0000000000c1';
const CHILD_2 = '00000000-0000-4000-8000-0000000000c2';

/** 0004 migration の SQL を statement-breakpoint で分割して返す。 */
function loadMigration0004Statements(): string[] {
	const sqlText = readFileSync(
		join(process.cwd(), 'drizzle', 'pglite', '0004_drop_login_bonuses.sql'),
		'utf-8',
	);
	return sqlText
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

describe('pg migration 0004: login_bonuses → login_streaks fold (#3330)', () => {
	let client: PGlite;

	beforeAll(async () => {
		client = new PGlite();
		// 旧 login_bonuses (0000 時点 DDL) + 受け皿 login_streaks (0003 と同形)
		await client.exec(`
			CREATE TABLE "login_bonuses" (
				"family_id" uuid NOT NULL,
				"child_id" uuid NOT NULL,
				"login_date" text NOT NULL,
				"rank" text NOT NULL,
				"base_points" integer NOT NULL,
				"multiplier" real DEFAULT 1 NOT NULL,
				"total_points" integer NOT NULL,
				"consecutive_days" integer DEFAULT 1 NOT NULL,
				"created_at" timestamp with time zone DEFAULT now() NOT NULL,
				CONSTRAINT "login_bonuses_family_id_child_id_login_date_pk" PRIMARY KEY("family_id","child_id","login_date")
			);
			CREATE TABLE "login_streaks" (
				"family_id" uuid NOT NULL,
				"child_id" uuid NOT NULL,
				"last_login_date" text NOT NULL,
				"current_streak" integer DEFAULT 1 NOT NULL,
				"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
				CONSTRAINT "login_streaks_family_id_child_id_pk" PRIMARY KEY("family_id","child_id")
			);
		`);
		// fixture: family A child1 = 5 連続日 / family A child2 = 途切れ (最新 run 1 日) /
		// family B child1 = 2 連続日 (family 分離検証)
		const rows: [string, string, string][] = [
			...['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'].map(
				(d): [string, string, string] => [FAMILY_A, CHILD_1, d],
			),
			...['2026-07-01', '2026-07-02', '2026-07-10'].map((d): [string, string, string] => [
				FAMILY_A,
				CHILD_2,
				d,
			]),
			...['2026-07-18', '2026-07-19'].map((d): [string, string, string] => [FAMILY_B, CHILD_1, d]),
		];
		for (const [family, child, date] of rows) {
			await client.query(
				`INSERT INTO login_bonuses (family_id, child_id, login_date, rank, base_points, total_points, created_at)
				 VALUES ($1, $2, $3, '吉', 3, 3, ($3 || 'T07:00:00Z')::timestamptz)`,
				[family, child, date],
			);
		}
	}, 60_000);
	afterAll(async () => {
		await client.close();
	});

	it('実 0004 SQL の fold が per-date fixture から counter 期待値を導出し、旧表を DROP する', async () => {
		for (const stmt of loadMigration0004Statements()) {
			await client.exec(stmt);
		}

		const res = await client.query(
			`SELECT family_id, child_id, last_login_date, current_streak FROM login_streaks
			 ORDER BY family_id, child_id`,
		);
		expect(res.rows).toEqual([
			{
				family_id: FAMILY_A,
				child_id: CHILD_1,
				last_login_date: '2026-07-19',
				current_streak: 5,
			},
			{
				family_id: FAMILY_A,
				child_id: CHILD_2,
				last_login_date: '2026-07-10',
				current_streak: 1, // 途切れ後の最新 run のみ
			},
			{
				family_id: FAMILY_B,
				child_id: CHILD_1,
				last_login_date: '2026-07-19',
				current_streak: 2, // family 単位で独立に fold
			},
		]);

		// 旧表は DROP 済
		const tables = await client.query(
			`SELECT table_name FROM information_schema.tables WHERE table_name = 'login_bonuses'`,
		);
		expect(tables.rows).toHaveLength(0);
	});
});

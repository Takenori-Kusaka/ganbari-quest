// tests/integration/db/legacy-schema-upgrade.test.ts
//
// #2520 AC2 — 既存 DB upgrade path startup test (research §2 Class 2、#2508 捕捉)
//
// 「fresh DB only test の危険性」への対策。既存 E2E / global-setup は毎回 fresh DB で
// 起動するため、#2508 (旧 schema を載せた既存 DB を新 schema に upgrade する経路) を
// 永遠に捕捉できない。本 test は `tests/fixtures/legacy-schema/*.sql` (直近本番 schema の
// snapshot、EF Core model snapshot pattern / AC1) を入力として、
//
//   1. legacy production schema (fixture SQL) を seed
//   2. applyLazyStartupMigrations(db)   ← shadow-table recreation 系 (client.ts startup と同順)
//   3. db.exec(SQL_CREATE_TABLES)       ← #2508 はここで `no such column: tenant_id` で fail した
//   4. validateAndMigrate(db)           ← drizzle 差分 ALTER
//
// の全 step が no-error で完了し、その後 child home 描画に必要な data
// (child 一覧 + child_activities + 履歴) が取得できる (= health 200 相当) ことを検証する。
//
// 既存 `tests/integration/db/startup-upgrade-path.test.ts` (#2508 hotfix の inline seed 版) とは
// 別 file。本 file は fixture SQL を読み込む snapshot 駆動で、schema 破壊変更 PR ごとに
// `tests/fixtures/legacy-schema/<YYYY-MM>.sql` を 1 世代追加すれば自動的に対象が増える (AC3)。
//
// 関連: #2508 (startup failure) / #2510 (data recovery) / #2513 (PR #2515) / ADR-0055

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SQL_CREATE_TABLES } from '../../../src/lib/server/db/create-tables';
import { applyLazyStartupMigrations } from '../../../src/lib/server/db/migration/lazy-startup-migrations';
import { validateAndMigrate } from '../../../src/lib/server/db/schema-validator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/legacy-schema');

/** legacy-schema fixture ディレクトリ内の *.sql snapshot 一覧を取得する。 */
function listLegacySchemaFixtures(): string[] {
	if (!fs.existsSync(FIXTURE_DIR)) return [];
	return fs
		.readdirSync(FIXTURE_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
}

interface FkInfo {
	table: string;
	from: string;
	to: string;
}
function fkTargets(db: Database.Database, table: string): FkInfo[] {
	return db.prepare(`PRAGMA foreign_key_list(${table})`).all() as FkInfo[];
}

/**
 * client.ts startup と同順の upgrade シーケンスを実行する。
 * 各 step が throw しないことを assert し、最終 DB を返す。
 */
function runStartupSequence(db: Database.Database): void {
	expect(() => applyLazyStartupMigrations(db)).not.toThrow();
	expect(() => db.exec(SQL_CREATE_TABLES)).not.toThrow();
	const result = validateAndMigrate(db);
	expect(result.errors, `validateAndMigrate errors: ${JSON.stringify(result.errors)}`).toEqual([]);
}

describe('legacy schema upgrade path (fixture SQL → new schema startup、#2520 AC2)', () => {
	const fixtures = listLegacySchemaFixtures();

	it('legacy-schema fixture が 1 件以上存在する (AC1 / AC3)', () => {
		// snapshot が無いと upgrade path 回帰が空になる事故を防ぐ precondition assert (ADR-0006)
		expect(fixtures.length, `${FIXTURE_DIR} に *.sql snapshot が必要`).toBeGreaterThanOrEqual(1);
	});

	for (const fixture of fixtures) {
		describe(`fixture: ${fixture}`, () => {
			const fixtureSql = fs.readFileSync(path.join(FIXTURE_DIR, fixture), 'utf8');

			it('legacy DB → startup シーケンスが no-error で完了する (#2508 捕捉)', () => {
				const db = new Database(':memory:');
				db.pragma('foreign_keys = ON');
				try {
					db.exec(fixtureSql);
					runStartupSequence(db);

					// 起動後 schema が新状態であること: activity_* の FK target = child_activities
					for (const table of [
						'activity_logs',
						'daily_missions',
						'activity_mastery',
						'child_activity_preferences',
					]) {
						const activityFk = fkTargets(db, table).find((fk) => fk.from === 'activity_id');
						expect(activityFk?.table, `${table}.activity_id FK target`).toBe('child_activities');
					}
				} finally {
					db.close();
				}
			});

			it('upgrade 後に child home 描画 data (child + child_activities + 履歴) が取得できる (health 200 相当)', () => {
				const db = new Database(':memory:');
				db.pragma('foreign_keys = ON');
				try {
					db.exec(fixtureSql);

					// 既存 NUC 相当のデータを投入 (PR #2487 後の orphan 状態を含む):
					// children / activities (旧 per-table) に実データ、child_activities は空。
					db.prepare(
						"INSERT INTO children (nickname, age, ui_mode) VALUES ('けんた', 9, 'elementary')",
					).run();
					db.prepare(
						"INSERT INTO children (nickname, age, ui_mode) VALUES ('ゆうこ', 15, 'junior')",
					).run();
					db.prepare("INSERT INTO activities (name) VALUES ('walk')").run(); // id=1
					db.prepare("INSERT INTO activities (name) VALUES ('study')").run(); // id=2
					db.prepare(
						"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 10, '2026-05-27')",
					).run();
					db.prepare(
						"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 1, 5, '2026-05-26')",
					).run();
					db.prepare(
						"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (2, 2, 8, '2026-05-26')",
					).run();

					runStartupSequence(db);

					// === child home 描画 data 取得成立 (= health 200 相当の業務的確認) ===

					// (a) child 一覧が取得できる (/switch・home の前提)
					const children = db
						.prepare('SELECT id, nickname, ui_mode FROM children ORDER BY id')
						.all() as { id: number; nickname: string; ui_mode: string }[];
					expect(children.length).toBe(2);
					expect(children[0]?.nickname).toBe('けんた');

					// (b) 各 child の child_activities が生成され home の活動一覧が描画できる
					const childAActivities = (
						db.prepare('SELECT COUNT(*) AS c FROM child_activities WHERE child_id = 1').get() as {
							c: number;
						}
					).c;
					expect(childAActivities, 'child A の home 活動一覧が空でないこと').toBeGreaterThan(0);

					// (c) 履歴が orphan ゼロ (activity_logs が child_activities を正しく参照)
					const orphanLogs = (
						db
							.prepare(
								`SELECT COUNT(*) AS c FROM activity_logs al
								 WHERE NOT EXISTS (SELECT 1 FROM child_activities ca WHERE ca.id = al.activity_id)`,
							)
							.get() as { c: number }
					).c;
					expect(orphanLogs, 'activity_logs の orphan は 0 件 (履歴表示が成立)').toBe(0);

					// (d) child A の活動履歴が child_activities 経由で JOIN できる (UI の履歴表示)
					const childAHistory = (
						db
							.prepare(
								`SELECT COUNT(*) AS c FROM activity_logs al
								 JOIN child_activities ca ON ca.id = al.activity_id
								 WHERE al.child_id = 1 AND ca.child_id = 1`,
							)
							.get() as { c: number }
					).c;
					expect(childAHistory, 'child A の履歴が JOIN で辿れること').toBe(2);
				} finally {
					db.close();
				}
			});

			it('再起動 (2 回目シーケンス) も no-error (冪等)', () => {
				const db = new Database(':memory:');
				db.pragma('foreign_keys = ON');
				try {
					db.exec(fixtureSql);
					runStartupSequence(db);
					// 2 回目 (再起動相当) も throw しない
					runStartupSequence(db);
				} finally {
					db.close();
				}
			});
		});
	}
});

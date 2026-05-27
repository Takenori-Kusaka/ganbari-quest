// tests/integration/db/data-orphan-gate.test.ts
//
// Issue #2519 (#2518 KPT umbrella) runtime data orphan gate の回帰テスト。
//
// 検証する不変条件:
//   1. legacy production schema (FK→activities) を seed → startup full sequence
//      (applyLazyStartupMigrations → SQL_CREATE_TABLES → validateAndMigrate →
//       assertNoDataOrphans) を通すと orphan = 0 (dim 4 data copy が自動修復し
//      gate が PASS する)
//   2. dim 4 が走れない壊れた DB (activities source 不在で orphan が残る) では
//      assertNoDataOrphans が orphan を検出して throw する (= Issue #2510 のような
//      「黙って data が見えなくなる」状態を startup で必ず fail-loud にする)
//   3. orphan の無い健全な DB では throw しない
//   4. onOrphan callback が orphan 検出時に呼ばれる (Discord alert DI hook)
//
// 本 gate が無かったため #2510 (NUC activities 全件 orphan) はどの CI / startup
// チェックでも鳴らなかった。本テストはその構造的盲点が再発しないことを保証する。

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SQL_CREATE_TABLES } from '../../../src/lib/server/db/create-tables';
import {
	assertNoDataOrphans,
	collectDataOrphans,
} from '../../../src/lib/server/db/migration/data-integrity-guards';
import { applyLazyStartupMigrations } from '../../../src/lib/server/db/migration/lazy-startup-migrations';
import { validateAndMigrate } from '../../../src/lib/server/db/schema-validator';

/**
 * NUC production (#2508 / #2510 発生時点) の旧 schema を再現する seed。
 * activity 系 4 table は FK target = activities (旧)、child_activities は空。
 * startup-upgrade-path.test.ts の seedLegacyProductionDb と同形 (FK target 旧)。
 */
function seedLegacyProductionDb(db: Database.Database): void {
	db.pragma('foreign_keys = OFF');
	db.exec(`
		CREATE TABLE children (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			nickname TEXT NOT NULL,
			age INTEGER NOT NULL DEFAULT 5,
			theme TEXT NOT NULL DEFAULT 'pink',
			ui_mode TEXT NOT NULL DEFAULT 'preschool',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			is_archived INTEGER NOT NULL DEFAULT 0,
			archived_reason TEXT
		);
		CREATE TABLE categories (
			id INTEGER PRIMARY KEY,
			code TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			icon TEXT,
			color TEXT
		);
		CREATE TABLE activities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			category_id INTEGER REFERENCES categories(id),
			icon TEXT NOT NULL DEFAULT '⭐',
			base_points INTEGER NOT NULL DEFAULT 5,
			is_visible INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'seed',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			is_archived INTEGER NOT NULL DEFAULT 0,
			archived_reason TEXT,
			priority TEXT NOT NULL DEFAULT 'optional'
		);
		CREATE TABLE child_activities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			name TEXT NOT NULL,
			category_id INTEGER REFERENCES categories(id),
			icon TEXT NOT NULL DEFAULT '⭐',
			base_points INTEGER NOT NULL DEFAULT 5,
			is_visible INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'seed',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			is_archived INTEGER NOT NULL DEFAULT 0,
			archived_reason TEXT,
			priority TEXT NOT NULL DEFAULT 'optional'
		);
		CREATE TABLE activity_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			activity_id INTEGER NOT NULL REFERENCES activities(id),
			points INTEGER NOT NULL,
			streak_days INTEGER NOT NULL DEFAULT 1,
			streak_bonus INTEGER NOT NULL DEFAULT 0,
			recorded_date TEXT NOT NULL,
			recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			cancelled INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE daily_missions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			mission_date TEXT NOT NULL,
			activity_id INTEGER NOT NULL REFERENCES activities(id),
			completed INTEGER NOT NULL DEFAULT 0,
			completed_at TEXT
		);
		CREATE TABLE activity_mastery (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			activity_id INTEGER NOT NULL REFERENCES activities(id),
			total_count INTEGER NOT NULL DEFAULT 0,
			level INTEGER NOT NULL DEFAULT 1,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE child_activity_preferences (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
			activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
			is_pinned INTEGER NOT NULL DEFAULT 0,
			pin_order INTEGER,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`);
	db.pragma('foreign_keys = ON');
}

/** legacy DB に child + 旧 activities + 各 4 table の参照 row を投入 (#2510 再現素材)。 */
function seedLegacyDataWithReferences(db: Database.Database): void {
	db.pragma('foreign_keys = OFF');
	db.prepare("INSERT INTO children (id, nickname, age) VALUES (1, 'A', 5)").run();
	db.prepare("INSERT INTO activities (id, name) VALUES (10, 'walk')").run();
	db.prepare("INSERT INTO activities (id, name) VALUES (11, 'study')").run();
	// 4 table に旧 activity_id を参照する row を入れる (この時点では child_activities が空)
	db.prepare(
		"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 10, 5, '2026-05-01')",
	).run();
	db.prepare(
		"INSERT INTO daily_missions (child_id, mission_date, activity_id) VALUES (1, '2026-05-01', 11)",
	).run();
	db.prepare(
		'INSERT INTO activity_mastery (child_id, activity_id, total_count) VALUES (1, 10, 3)',
	).run();
	db.prepare(
		'INSERT INTO child_activity_preferences (child_id, activity_id, is_pinned) VALUES (1, 11, 1)',
	).run();
	db.pragma('foreign_keys = ON');
}

describe('runtime data orphan gate (#2519)', () => {
	// 注: vitest は起動時に VITEST='true' を設定するため、$lib/runtime/env 経由の
	// isTestEnv() は本テスト runtime で true。throwOnOrphan を明示しない呼出は throw する。
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('legacy schema + 参照 row を startup full sequence で通すと orphan=0 (dim 4 が自動修復) → gate PASS', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		try {
			seedLegacyProductionDb(db);
			seedLegacyDataWithReferences(db);

			// === client.ts と同 sequence ===
			expect(() => applyLazyStartupMigrations(db)).not.toThrow();
			expect(() => db.exec(SQL_CREATE_TABLES)).not.toThrow();
			const result = validateAndMigrate(db);
			expect(result.errors, `unexpected errors: ${JSON.stringify(result.errors)}`).toEqual([]);

			// === gate: dim 4 data copy が orphan を解消済 → throw しない ===
			expect(() => assertNoDataOrphans(db, { throwOnOrphan: true })).not.toThrow();

			// child_activities に row が copy され、4 table が全て解消されていること
			const report = collectDataOrphans(db);
			expect(report.total).toBe(0);
			const childActCount = (
				db.prepare('SELECT COUNT(*) AS c FROM child_activities').get() as { c: number }
			).c;
			expect(childActCount).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	it('child_activities に存在しない activity_id を指す orphan row を検出して throw する', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = OFF'); // orphan を意図的に作るため FK OFF
		try {
			// 新 schema (FK→child_activities) を直接作成。child_activities は空のまま
			// orphan な activity_logs row を 2 件挿入 (#2510 と同型の「参照先が無い」状態)
			db.exec(SQL_CREATE_TABLES);
			db.prepare("INSERT INTO children (id, nickname, age) VALUES (1, 'A', 5)").run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 999, 5, '2026-05-01')",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 998, 3, '2026-05-02')",
			).run();
			db.prepare(
				'INSERT INTO activity_mastery (child_id, activity_id, total_count) VALUES (1, 997, 1)',
			).run();

			const report = collectDataOrphans(db);
			expect(report.counts.activity_logs).toBe(2);
			expect(report.counts.activity_mastery).toBe(1);
			expect(report.total).toBe(3);

			// gate は throw する (test 環境)
			expect(() => assertNoDataOrphans(db)).toThrowError(/DATA ORPHAN detected/);
		} finally {
			db.close();
		}
	});

	it('orphan の無い健全な DB では throw しない & total=0', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		try {
			db.exec(SQL_CREATE_TABLES);
			db.prepare("INSERT INTO children (id, nickname, age) VALUES (1, 'A', 5)").run();
			db.prepare(
				"INSERT OR IGNORE INTO categories (id, code, name) VALUES (1, 'undou', 'うんどう')",
			).run();
			db.prepare(
				"INSERT INTO child_activities (id, child_id, name, category_id, icon) VALUES (50, 1, 'walk', 1, '⭐')",
			).run();
			db.prepare(
				"INSERT INTO activity_logs (child_id, activity_id, points, recorded_date) VALUES (1, 50, 5, '2026-05-01')",
			).run();

			let report = collectDataOrphans(db);
			expect(report.total).toBe(0);
			report = assertNoDataOrphans(db, { throwOnOrphan: true });
			expect(report.total).toBe(0);
		} finally {
			db.close();
		}
	});

	it('onOrphan callback が orphan 検出時に呼ばれる (Discord alert DI hook)', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = OFF');
		try {
			db.exec(SQL_CREATE_TABLES);
			db.prepare("INSERT INTO children (id, nickname, age) VALUES (1, 'A', 5)").run();
			db.prepare(
				"INSERT INTO daily_missions (child_id, mission_date, activity_id) VALUES (1, '2026-05-01', 12345)",
			).run();

			const onOrphan = vi.fn();
			// throwOnOrphan: false で callback だけ確認 (本番起動経路相当)
			const report = assertNoDataOrphans(db, { onOrphan, throwOnOrphan: false });

			expect(report.counts.daily_missions).toBe(1);
			expect(onOrphan).toHaveBeenCalledTimes(1);
			expect(onOrphan).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
		} finally {
			db.close();
		}
	});
});

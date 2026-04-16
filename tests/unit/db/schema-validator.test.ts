// tests/unit/db/schema-validator.test.ts
// schema-validator.ts のユニットテスト
// ADR-0031: ALTER TABLE ADD COLUMN 時の DEFAULT 抽出 + backfill UPDATE の検証

import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	deriveBackfillValue,
	extractDefaultClause,
	validateAndMigrate,
} from '$lib/server/db/schema-validator';

// ============================================================
// extractDefaultClause / deriveBackfillValue の単体テスト
// ============================================================

describe('extractDefaultClause', () => {
	it('number 定数から { clause, isConstant: true } を返す', () => {
		expect(extractDefaultClause({ default: 0, hasDefault: true, primary: false })).toEqual({
			clause: '0',
			isConstant: true,
		});
		expect(extractDefaultClause({ default: 1, hasDefault: true, primary: false })).toEqual({
			clause: '1',
			isConstant: true,
		});
		expect(extractDefaultClause({ default: 1.5, hasDefault: true, primary: false })).toEqual({
			clause: '1.5',
			isConstant: true,
		});
	});

	it('string 定数から { clause (クォート付き), isConstant: true } を返す', () => {
		expect(extractDefaultClause({ default: 'pink', hasDefault: true, primary: false })).toEqual({
			clause: "'pink'",
			isConstant: true,
		});
		expect(extractDefaultClause({ default: 'seed', hasDefault: true, primary: false })).toEqual({
			clause: "'seed'",
			isConstant: true,
		});
	});

	it('string にシングルクォートが含まれる場合エスケープされる', () => {
		expect(extractDefaultClause({ default: "it's", hasDefault: true, primary: false })).toEqual({
			clause: "'it''s'",
			isConstant: true,
		});
	});

	it('primary key の場合 undefined を返す', () => {
		expect(extractDefaultClause({ default: undefined, hasDefault: true, primary: true })).toBe(
			undefined,
		);
	});

	it('hasDefault=false の場合 undefined を返す', () => {
		expect(extractDefaultClause({ default: undefined, hasDefault: false, primary: false })).toBe(
			undefined,
		);
	});

	it('SQL オブジェクト (CURRENT_TIMESTAMP) から { clause, isConstant: false } を返す', () => {
		const sqlDefault = sql`CURRENT_TIMESTAMP`;
		expect(extractDefaultClause({ default: sqlDefault, hasDefault: true, primary: false })).toEqual(
			{ clause: 'CURRENT_TIMESTAMP', isConstant: false },
		);
	});
});

describe('deriveBackfillValue', () => {
	it('定数値をそのまま返す', () => {
		expect(deriveBackfillValue('0')).toBe('0');
		expect(deriveBackfillValue("'pink'")).toBe("'pink'");
	});

	it('SQL 式をそのまま返す', () => {
		expect(deriveBackfillValue('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
	});

	it('undefined → undefined', () => {
		expect(deriveBackfillValue(undefined)).toBe(undefined);
	});
});

// ============================================================
// validateAndMigrate 統合テスト
// ============================================================

describe('validateAndMigrate — DEFAULT 抽出 + backfill', () => {
	let sqlite: InstanceType<typeof Database>;

	beforeEach(() => {
		sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys = OFF');
	});

	afterEach(() => {
		sqlite.close();
	});

	it('INTEGER DEFAULT 0 カラム追加時に DEFAULT 節が付与され、既存行が backfill される', () => {
		// children テーブルを is_archived なしで作成（古い DB を模倣）
		sqlite.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
		`);

		// 既存データを投入（is_archived カラムなし = auto-migrate 前）
		sqlite.exec(`
			INSERT INTO children (nickname, age) VALUES ('太郎', 5);
			INSERT INTO children (nickname, age) VALUES ('花子', 3);
		`);

		// auto-migrate を実行
		const result = validateAndMigrate(sqlite);

		// is_archived が追加されたか確認
		const appliedCols = result.applied.map((a) => `${a.table}.${a.column}`);
		expect(appliedCols).toContain('children.is_archived');

		// 追加された SQL に DEFAULT と backfill UPDATE が含まれるか確認
		const isArchivedEntry = result.applied.find(
			(a) => a.table === 'children' && a.column === 'is_archived',
		);
		expect(isArchivedEntry?.sql).toContain('DEFAULT 0');
		expect(isArchivedEntry?.sql).toContain(
			'UPDATE children SET is_archived = 0 WHERE is_archived IS NULL',
		);

		// 既存行が NULL ではなく 0 になっていることを確認（#962 の再発防止）
		const rows = sqlite.prepare('SELECT nickname, is_archived FROM children').all() as Array<{
			nickname: string;
			is_archived: number | null;
		}>;
		for (const row of rows) {
			expect(row.is_archived).toBe(0);
		}
	});

	it('TEXT DEFAULT カラム追加時にクォート付き DEFAULT が付与される', () => {
		// activities テーブルを source なしで作成
		sqlite.exec(`
			CREATE TABLE activities (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				category_id INTEGER NOT NULL,
				icon TEXT NOT NULL,
				base_points INTEGER NOT NULL DEFAULT 5
			);
		`);

		sqlite.exec(`
			INSERT INTO activities (name, category_id, icon) VALUES ('テスト', 1, '🏃');
		`);

		const result = validateAndMigrate(sqlite);

		// source カラムの追加を確認
		const sourceEntry = result.applied.find(
			(a) => a.table === 'activities' && a.column === 'source',
		);
		expect(sourceEntry).toBeDefined();
		expect(sourceEntry?.sql).toContain("DEFAULT 'seed'");

		// 既存行が 'seed' で backfill されていることを確認
		const rows = sqlite.prepare('SELECT source FROM activities').all() as Array<{
			source: string | null;
		}>;
		expect(rows[0].source).toBe('seed');
	});

	it('REAL DEFAULT カラム追加時に数値 DEFAULT が付与される', () => {
		// children テーブルを birthday_bonus_multiplier なしで作成
		sqlite.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
		`);

		sqlite.exec(`INSERT INTO children (nickname, age) VALUES ('太郎', 5);`);

		const result = validateAndMigrate(sqlite);

		const bbnEntry = result.applied.find(
			(a) => a.table === 'children' && a.column === 'birthday_bonus_multiplier',
		);
		expect(bbnEntry).toBeDefined();
		expect(bbnEntry?.sql).toContain('DEFAULT 1');

		const rows = sqlite.prepare('SELECT birthday_bonus_multiplier FROM children').all() as Array<{
			birthday_bonus_multiplier: number | null;
		}>;
		expect(rows[0].birthday_bonus_multiplier).toBe(1);
	});

	it('DEFAULT なしの nullable カラムは backfill なしで追加される', () => {
		// children テーブルを avatar_url なしで作成
		sqlite.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				is_archived INTEGER NOT NULL DEFAULT 0
			);
		`);

		sqlite.exec(`INSERT INTO children (nickname, age) VALUES ('太郎', 5);`);

		const result = validateAndMigrate(sqlite);

		const avatarEntry = result.applied.find(
			(a) => a.table === 'children' && a.column === 'avatar_url',
		);
		expect(avatarEntry).toBeDefined();
		// DEFAULT なしなので backfill UPDATE は含まれない
		expect(avatarEntry?.sql).not.toContain('UPDATE');

		// 値は NULL のまま
		const rows = sqlite.prepare('SELECT avatar_url FROM children').all() as Array<{
			avatar_url: string | null;
		}>;
		expect(rows[0].avatar_url).toBeNull();
	});

	it('回帰テスト: NULL 混在行 → auto-migrate → eq(is_archived, 0) で既存行が返る', () => {
		// #962 の再現シナリオ: is_archived なしの旧テーブルに既存データあり
		sqlite.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO children (nickname, age) VALUES ('レガシー太郎', 5);
			INSERT INTO children (nickname, age) VALUES ('レガシー花子', 3);
		`);

		// auto-migrate で is_archived が追加 + backfill される
		validateAndMigrate(sqlite);

		// eq(is_archived, 0) 相当のクエリで既存行が返るか確認
		const rows = sqlite
			.prepare('SELECT nickname FROM children WHERE is_archived = 0')
			.all() as Array<{ nickname: string }>;
		const names = rows.map((r) => r.nickname);

		expect(names).toContain('レガシー太郎');
		expect(names).toContain('レガシー花子');
		expect(names).toHaveLength(2);
	});

	it('CURRENT_TIMESTAMP の非定数 DEFAULT は ALTER TABLE DEFAULT 節なしで追加し backfill される', () => {
		// SQLite の ALTER TABLE ADD COLUMN は非定数 DEFAULT (CURRENT_TIMESTAMP) を許容しないため、
		// DEFAULT 節なしで追加し、backfill UPDATE で値を補完する。
		sqlite.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
				is_archived INTEGER NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
		`);

		sqlite.exec(`INSERT INTO children (nickname, age) VALUES ('太郎', 5);`);

		const result = validateAndMigrate(sqlite);

		const createdAtEntry = result.applied.find(
			(a) => a.table === 'children' && a.column === 'created_at',
		);
		expect(createdAtEntry).toBeDefined();
		// 非定数 DEFAULT は ALTER TABLE には含まれないが、backfill UPDATE で CURRENT_TIMESTAMP が使われる
		expect(createdAtEntry?.sql).not.toContain('DEFAULT CURRENT_TIMESTAMP');
		expect(createdAtEntry?.sql).toContain(
			'UPDATE children SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL',
		);

		// backfill で CURRENT_TIMESTAMP が設定される
		const rows = sqlite.prepare('SELECT created_at FROM children').all() as Array<{
			created_at: string | null;
		}>;
		expect(rows[0].created_at).not.toBeNull();
	});

	it('create-tables.ts と validator で同じ結果になる（完全テーブル vs ALTER TABLE）', () => {
		// 方法1: CREATE TABLE で全カラムあり
		const fullDb = new Database(':memory:');
		fullDb.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				is_archived INTEGER NOT NULL DEFAULT 0,
				archived_reason TEXT,
				avatar_url TEXT,
				display_config TEXT,
				user_id TEXT,
				last_birthday_bonus_year INTEGER,
				birth_date TEXT,
				_sv INTEGER
			);
			INSERT INTO children (nickname, age) VALUES ('太郎', 5);
		`);

		// 方法2: 旧テーブル + validateAndMigrate
		sqlite.exec(`
			CREATE TABLE children (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT NOT NULL,
				age INTEGER NOT NULL,
				theme TEXT NOT NULL DEFAULT 'pink',
				ui_mode TEXT NOT NULL DEFAULT 'preschool',
				birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO children (nickname, age) VALUES ('太郎', 5);
		`);
		validateAndMigrate(sqlite);

		// 両方の is_archived を比較
		const fullRow = fullDb.prepare('SELECT is_archived FROM children').get() as {
			is_archived: number | null;
		};
		const migratedRow = sqlite.prepare('SELECT is_archived FROM children').get() as {
			is_archived: number | null;
		};

		expect(migratedRow.is_archived).toBe(fullRow.is_archived);
		expect(migratedRow.is_archived).toBe(0);

		fullDb.close();
	});
});

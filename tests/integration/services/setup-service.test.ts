// tests/integration/services/setup-service.test.ts
// #965: isSetupRequired の DB 直結統合テスト。
// Postmortem #962 の根本原因（mock ベースのユニットテストのみで、クエリ変更を
// 検出できなかった）への対処として、実 SQLite を通した挙動を検証する。

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

// #962 再現用: is_archived を nullable にしてある。
// 本番で #962 が起きた時の DB は ALTER TABLE ADD COLUMN is_archived INTEGER DEFAULT 0
// で追加された列だったため、既存行は NOT NULL 制約を受けずに NULL のまま残存していた。
// このテストは ADR-0031 D-2（NULL 混在行テスト必須）準拠の回帰テスト。
const SQL_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL,
		age INTEGER NOT NULL,
		birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'preschool',
		ui_mode_manually_set INTEGER NOT NULL DEFAULT 0,
		avatar_url TEXT,
		active_title_id INTEGER,
		display_config TEXT,
		user_id TEXT,
		birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
		last_birthday_bonus_year INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER,
		is_archived INTEGER DEFAULT 0,
		archived_reason TEXT
	);
`;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
	get rawSqlite() {
		return sqlite;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isSetupRequired } from '$lib/server/services/setup-service';

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
});

afterAll(() => {
	sqlite.close();
});

function resetDb() {
	sqlite.exec('DELETE FROM children');
	sqlite.exec("DELETE FROM sqlite_sequence WHERE name = 'children'");
}

function insertActiveChild(nickname: string) {
	testDb.insert(schema.children).values({ nickname, age: 5 }).run();
}

function insertArchivedChild(nickname: string, reason = 'trial_expired') {
	sqlite
		.prepare(
			'INSERT INTO children (nickname, age, is_archived, archived_reason) VALUES (?, 5, 1, ?)',
		)
		.run(nickname, reason);
}

/**
 * #962 再現: is_archived カラムが NULL の行（drizzle-kit push 直後、
 * 古いデータの backfill 前の中間状態）をシード。
 */
function insertLegacyNullArchivedChild(nickname: string) {
	sqlite
		.prepare('INSERT INTO children (nickname, age, is_archived) VALUES (?, 5, NULL)')
		.run(nickname);
}

const TENANT = 'test-tenant';

beforeEach(() => {
	resetDb();
});

describe('#965 isSetupRequired — 統合テスト（実 SQLite）', () => {
	it('active な子供が1人でも存在する場合 false', async () => {
		insertActiveChild('テスト太郎');

		const result = await isSetupRequired(TENANT);

		expect(result).toBe(false);
	});

	it('子供が1人も存在しない場合 true（新規テナント）', async () => {
		const result = await isSetupRequired(TENANT);

		expect(result).toBe(true);
	});

	it('全子供が archived の場合 false（セットアップ済みとみなす）', async () => {
		insertArchivedChild('アーカイブ済み1');
		insertArchivedChild('アーカイブ済み2');

		const result = await isSetupRequired(TENANT);

		expect(result).toBe(false);
	});

	it('active と archived が混在している場合 false', async () => {
		insertActiveChild('アクティブ太郎');
		insertArchivedChild('アーカイブ花子');

		const result = await isSetupRequired(TENANT);

		expect(result).toBe(false);
	});

	it('is_archived が NULL の既存行がある場合 false（#962 回帰テスト）', async () => {
		// Postmortem #962: ALTER TABLE ADD COLUMN で DEFAULT 0 が即座に反映されず、
		// 既存行が NULL のまま残った場合、findAllChildren が空配列を返して
		// isSetupRequired が true を誤返却 → /setup への無限リダイレクトが発生した。
		insertLegacyNullArchivedChild('レガシー太郎');

		const result = await isSetupRequired(TENANT);

		// findAllChildren は is_archived = 0 OR IS NULL を active として扱うため、
		// NULL 行も 1 人として検出され false を返すべき。
		expect(result).toBe(false);
	});
});

describe('#965 isSetupRequired — DB エラー時フォールバック', () => {
	it('children テーブルが存在しない場合 false（リダイレクトループ防止）', async () => {
		// 本物の DB エラーをシミュレート: テーブルを drop して findAllChildren を失敗させる。
		// isSetupRequired の try/catch → logger.warn → return false 経路を検証。
		sqlite.exec('DROP TABLE children');
		try {
			const result = await isSetupRequired(TENANT);
			expect(result).toBe(false);
		} finally {
			// 他のテストに影響しないよう復元（afterAll で close されるが念のため）
			sqlite.exec(SQL_TABLES);
		}
	});
});

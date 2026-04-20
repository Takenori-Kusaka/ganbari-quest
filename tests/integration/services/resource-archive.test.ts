// tests/integration/services/resource-archive.test.ts
// #783: リソース archive / restore の統合テスト（実 SQLite DB）

import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

// ---- テスト用インメモリ DB ----
let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE categories (
		id INTEGER PRIMARY KEY,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		icon TEXT,
		color TEXT
	);

	INSERT INTO categories VALUES (1, 'undou', 'うんどう', '🏃', '#FF6B6B');
	INSERT INTO categories VALUES (2, 'benkyou', 'べんきょう', '📚', '#4ECDC4');
	INSERT INTO categories VALUES (3, 'seikatsu', 'せいかつ', '🏠', '#FFE66D');
	INSERT INTO categories VALUES (4, 'kouryuu', 'こうりゅう', '🤝', '#A8E6CF');
	INSERT INTO categories VALUES (5, 'souzou', 'そうぞう', '🎨', '#DDA0DD');

	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'preschool',
		avatar_url TEXT,
		active_title_id INTEGER,
		display_config TEXT,
		user_id TEXT,
		birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
		last_birthday_bonus_year INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER,
		is_archived INTEGER NOT NULL DEFAULT 0,
		archived_reason TEXT
	);

	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER, age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'seed',
		grade_level TEXT, subcategory TEXT, description TEXT,
		name_kana TEXT,
		name_kanji TEXT,
		trigger_hint TEXT,
		is_main_quest INTEGER NOT NULL DEFAULT 0,
		source_preset_id TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		is_archived INTEGER NOT NULL DEFAULT 0,
		archived_reason TEXT
	);

	CREATE TABLE checklist_templates (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📋',
		points_per_item INTEGER NOT NULL DEFAULT 2,
		completion_bonus INTEGER NOT NULL DEFAULT 5,
		time_slot TEXT NOT NULL DEFAULT 'anytime',
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		is_archived INTEGER NOT NULL DEFAULT 0,
		archived_reason TEXT,
		-- #1168: 持ち物 ('item') / ルーティン ('routine') 種別
		kind TEXT NOT NULL DEFAULT 'routine',
		source_preset_id TEXT
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
}));

import {
	ARCHIVE_REASON,
	archiveExcessResources,
	getArchivedResourceSummary,
	restoreArchivedResources,
} from '../../../src/lib/server/services/resource-archive-service';

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
	sqlite.exec('DELETE FROM checklist_templates');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','activities','checklist_templates')",
	);
}

function seedChildren(count: number) {
	for (let i = 1; i <= count; i++) {
		testDb
			.insert(schema.children)
			.values({ nickname: `テストちゃん${i}`, age: 4 })
			.run();
	}
}

function seedCustomActivities(count: number) {
	for (let i = 1; i <= count; i++) {
		testDb
			.insert(schema.activities)
			.values({
				name: `カスタム活動${i}`,
				categoryId: 1,
				icon: '🏃',
				basePoints: 5,
				source: 'custom',
				sortOrder: i,
			})
			.run();
	}
}

function seedSeedActivities(count: number) {
	for (let i = 1; i <= count; i++) {
		testDb
			.insert(schema.activities)
			.values({
				name: `シード活動${i}`,
				categoryId: 1,
				icon: '🏃',
				basePoints: 5,
				source: 'seed',
				sortOrder: i,
			})
			.run();
	}
}

function seedChecklistTemplates(childId: number, count: number) {
	for (let i = 1; i <= count; i++) {
		testDb
			.insert(schema.checklistTemplates)
			.values({ childId, name: `テンプレ${i}`, icon: '📋' })
			.run();
	}
}

function getVisibleChildren() {
	return testDb.select().from(schema.children).where(eq(schema.children.isArchived, 0)).all();
}

function getArchivedChildren() {
	return testDb.select().from(schema.children).where(eq(schema.children.isArchived, 1)).all();
}

function getVisibleCustomActivities() {
	return testDb
		.select()
		.from(schema.activities)
		.where(and(eq(schema.activities.isArchived, 0), eq(schema.activities.source, 'custom')))
		.all();
}

function getArchivedActivities() {
	return testDb.select().from(schema.activities).where(eq(schema.activities.isArchived, 1)).all();
}

function getVisibleTemplates(childId: number) {
	return testDb
		.select()
		.from(schema.checklistTemplates)
		.where(
			and(
				eq(schema.checklistTemplates.childId, childId),
				eq(schema.checklistTemplates.isArchived, 0),
			),
		)
		.all();
}

function getArchivedTemplates() {
	return testDb
		.select()
		.from(schema.checklistTemplates)
		.where(eq(schema.checklistTemplates.isArchived, 1))
		.all();
}

const TENANT = 'test-tenant';

beforeEach(() => {
	resetDb();
});

describe('#783 archiveExcessResources（実 DB）', () => {
	it('free 上限（2）を超える子供を archive: 古い順に2件残し、3件目以降を archive', async () => {
		seedChildren(4); // id=1,2,3,4

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedChildIds).toEqual([3, 4]);
		expect(getVisibleChildren()).toHaveLength(2);
		expect(getArchivedChildren()).toHaveLength(2);

		// archived_reason が正しくセットされている
		const archived = getArchivedChildren();
		for (const c of archived) {
			expect(c.archivedReason).toBe(ARCHIVE_REASON);
		}
	});

	it('free 上限（3）を超える custom 活動を archive', async () => {
		seedChildren(1); // archive 対象外
		seedCustomActivities(5); // id=1..5, custom 5件 → 3件残し2件 archive

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedActivityIds).toEqual([4, 5]);
		expect(getVisibleCustomActivities()).toHaveLength(3);
		expect(getArchivedActivities()).toHaveLength(2);
	});

	it('seed 活動は archive 対象外', async () => {
		seedChildren(1);
		seedSeedActivities(10); // seed はいくつあっても archive されない

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedActivityIds).toEqual([]);
		expect(getArchivedActivities()).toHaveLength(0);
	});

	it('free 上限（3）を超えるチェックリストを子供ごとに archive', async () => {
		seedChildren(1); // child id=1
		seedChecklistTemplates(1, 5); // 子供1に5件 → 3件残し2件 archive

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedChecklistTemplateIds).toHaveLength(2);
		expect(getVisibleTemplates(1)).toHaveLength(3);
		expect(getArchivedTemplates()).toHaveLength(2);
	});

	it('冪等性: 2回目の呼び出しでは何も archive しない', async () => {
		seedChildren(4);

		// 1回目
		const result1 = await archiveExcessResources(TENANT);
		expect(result1.archivedChildIds).toHaveLength(2);

		// 2回目
		const result2 = await archiveExcessResources(TENANT);
		expect(result2.archivedChildIds).toHaveLength(0);
		expect(result2.archivedActivityIds).toHaveLength(0);
		expect(result2.archivedChecklistTemplateIds).toHaveLength(0);

		// DB 状態は変わらない
		expect(getVisibleChildren()).toHaveLength(2);
		expect(getArchivedChildren()).toHaveLength(2);
	});

	it('上限以内なら何も archive しない', async () => {
		seedChildren(2); // free 上限ちょうど
		seedCustomActivities(3);

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedChildIds).toEqual([]);
		expect(result.archivedActivityIds).toEqual([]);
		expect(result.archivedChecklistTemplateIds).toEqual([]);
	});
});

describe('#783 restoreArchivedResources（実 DB）', () => {
	it('archive → restore で全リソースが復元される', async () => {
		seedChildren(4);
		seedCustomActivities(5);
		seedChildren(1); // 追加で子供 id=5 を作成（チェックリスト用ではない）

		// archive
		await archiveExcessResources(TENANT);
		expect(getVisibleChildren()).toHaveLength(2);
		expect(getVisibleCustomActivities()).toHaveLength(3);

		// restore
		await restoreArchivedResources(TENANT);
		expect(getVisibleChildren()).toHaveLength(5);
		expect(getVisibleCustomActivities()).toHaveLength(5);
		expect(getArchivedChildren()).toHaveLength(0);
		expect(getArchivedActivities()).toHaveLength(0);
	});

	it('trial_expired 以外の理由で archive されたものは restore しない', async () => {
		seedChildren(1); // child id=1

		// 別の理由で手動 archive
		sqlite.exec("UPDATE children SET is_archived = 1, archived_reason = 'manual' WHERE id = 1");
		expect(getVisibleChildren()).toHaveLength(0);

		// restore（trial_expired のみ対象）
		await restoreArchivedResources(TENANT);

		// manual は復元されない
		expect(getVisibleChildren()).toHaveLength(0);
		expect(getArchivedChildren()).toHaveLength(1);
	});
});

describe('#783 getArchivedResourceSummary', () => {
	it('archive 済みリソースがない場合', async () => {
		seedChildren(2);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(summary.archivedChildCount).toBe(0);
		expect(summary.hasArchivedResources).toBe(false);
	});

	it('archive 済みリソースがある場合', async () => {
		seedChildren(4);
		await archiveExcessResources(TENANT);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(summary.archivedChildCount).toBe(2);
		expect(summary.hasArchivedResources).toBe(true);
	});
});

// tests/integration/api/activity-api.test.ts
// 活動API統合テスト (API-ACT-01 〜 API-ACT-08)

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { createMockEvent } from '../../helpers/mock-event';

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
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		display_config TEXT,
		user_id TEXT,
		birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
		last_birthday_bonus_year INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER
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
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		points INTEGER NOT NULL, streak_days INTEGER NOT NULL DEFAULT 1,
		streak_bonus INTEGER NOT NULL DEFAULT 0,
		recorded_date TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		cancelled INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

// ハンドラのインポート（vi.mock の後に行う）
import { GET, POST } from '../../../src/routes/api/v1/activities/+server';
import {
	DELETE as DELETE_BY_ID,
	GET as GET_BY_ID,
	PATCH as PATCH_BY_ID,
} from '../../../src/routes/api/v1/activities/[id]/+server';
import { PATCH as PATCH_VISIBILITY } from '../../../src/routes/api/v1/activities/[id]/visibility/+server';

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
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','activities','activity_logs','point_ledger')",
	);
}

function seedBasic() {
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4 }).run();
	testDb
		.insert(schema.activities)
		.values({ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5, sortOrder: 1 })
		.run();
	testDb
		.insert(schema.activities)
		.values({
			name: 'ひらがな',
			categoryId: 2,
			icon: '✏️',
			basePoints: 5,
			ageMin: 3,
			sortOrder: 2,
		})
		.run();
	testDb
		.insert(schema.activities)
		.values({
			name: '非表示',
			categoryId: 1,
			icon: '❌',
			basePoints: 5,
			isVisible: 0,
			sortOrder: 99,
		})
		.run();
}

beforeEach(() => {
	resetDb();
	seedBasic();
});

// --- ヘルパー ---
async function jsonBody(res: Response) {
	return res.json();
}

// ===================================================================
// API-ACT-01: GET /api/v1/activities → 活動一覧取得
// ===================================================================
describe('API-ACT-01: GET /api/v1/activities', () => {
	it('活動一覧を取得できる（非表示は除外）', async () => {
		const event = createMockEvent({
			url: '/api/v1/activities',
		});
		const res = await GET(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.activities).toHaveLength(2); // 非表示を除く
		expect(body.activities[0].name).toBe('たいそう');
	});

	it('includeHidden=true で非表示も含む', async () => {
		const event = createMockEvent({
			url: '/api/v1/activities?includeHidden=true',
		});
		const res = await GET(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.activities).toHaveLength(3);
	});
});

// ===================================================================
// API-ACT-02: GET /api/v1/activities?childId=1 → 子供IDフィルタ
// ===================================================================
describe('API-ACT-02: GET /api/v1/activities?childId=1', () => {
	it('子供の年齢に合った活動のみ返す', async () => {
		// 5歳以上限定の活動を追加
		testDb
			.insert(schema.activities)
			.values({
				name: '英語',
				categoryId: 2,
				icon: '🇬🇧',
				basePoints: 5,
				ageMin: 5,
				sortOrder: 10,
			})
			.run();

		const event = createMockEvent({
			url: '/api/v1/activities?childId=1', // age=4
		});
		const res = await GET(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		// 4歳の子: 'たいそう'(制限なし), 'ひらがな'(3歳以上)  → 2件, '英語'(5歳以上)は除外
		expect(body.activities).toHaveLength(2);
		const names = body.activities.map((a: Record<string, unknown>) => a.name);
		expect(names).not.toContain('英語');
	});
});

// ===================================================================
// API-ACT-03: GET /api/v1/activities?category=うんどう → カテゴリフィルタ
// ===================================================================
describe('API-ACT-03: GET /api/v1/activities?categoryId=1', () => {
	it('指定カテゴリの活動のみ返す', async () => {
		const event = createMockEvent({
			url: '/api/v1/activities?categoryId=1',
		});
		const res = await GET(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.activities).toHaveLength(1); // 'たいそう' のみ（非表示除外）
		expect(body.activities[0].categoryId).toBe(1);
	});
});

// ===================================================================
// API-ACT-04: POST /api/v1/activities → 活動追加
// ===================================================================
describe('API-ACT-04: POST /api/v1/activities', () => {
	it('活動を追加できる (201)', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activities',
			body: {
				name: 'すいえい',
				categoryId: 1,
				icon: '🏊',
				basePoints: 10,
				ageMin: 3,
				ageMax: null,
			},
		});
		const res = await POST(event);
		expect(res.status).toBe(201);

		const body = await jsonBody(res);
		expect(body.name).toBe('すいえい');
		expect(body.basePoints).toBe(10);
	});
});

// ===================================================================
// API-ACT-06: POST /api/v1/activities → バリデーションエラー
// ===================================================================
describe('API-ACT-06: POST /api/v1/activities (validation error)', () => {
	it('不正なデータで 400 を返す', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activities',
			body: {
				name: '', // 空文字はバリデーションエラー
				categoryId: 1,
				icon: '🏊',
				basePoints: 10,
				ageMin: null,
				ageMax: null,
			},
		});
		const res = await POST(event);
		expect(res.status).toBe(400);

		const body = await jsonBody(res);
		expect(body.error.code).toBe('VALIDATION_ERROR');
	});

	it('不正なカテゴリで 400 を返す', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activities',
			body: {
				name: 'テスト',
				categoryId: 99,
				icon: '❌',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
			},
		});
		const res = await POST(event);
		expect(res.status).toBe(400);
	});
});

// ===================================================================
// API-ACT-07: PATCH /api/v1/activities/1 → 活動更新
// ===================================================================
describe('API-ACT-07: PATCH /api/v1/activities/:id', () => {
	it('活動を更新できる (200)', async () => {
		const event = createMockEvent({
			method: 'PATCH',
			url: '/api/v1/activities/1',
			params: { id: '1' },
			body: { name: 'ラジオたいそう', basePoints: 8 },
		});
		const res = await PATCH_BY_ID(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.name).toBe('ラジオたいそう');
		expect(body.basePoints).toBe(8);
	});

	it('存在しない ID で 404 を返す', async () => {
		const event = createMockEvent({
			method: 'PATCH',
			url: '/api/v1/activities/999',
			params: { id: '999' },
			body: { name: 'テスト' },
		});
		const res = await PATCH_BY_ID(event);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// API-ACT-08: PATCH /api/v1/activities/1/visibility → 表示/非表示切替
// ===================================================================
describe('API-ACT-08: PATCH /api/v1/activities/:id/visibility', () => {
	it('活動を非表示にできる (200)', async () => {
		const event = createMockEvent({
			method: 'PATCH',
			url: '/api/v1/activities/1/visibility',
			params: { id: '1' },
			body: { isVisible: false },
		});
		const res = await PATCH_VISIBILITY(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.isVisible).toBe(0);
	});

	it('非表示活動を表示に戻せる', async () => {
		const event = createMockEvent({
			method: 'PATCH',
			url: '/api/v1/activities/3/visibility',
			params: { id: '3' },
			body: { isVisible: true },
		});
		const res = await PATCH_VISIBILITY(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.isVisible).toBe(1);
	});

	it('存在しない ID で 404 を返す', async () => {
		const event = createMockEvent({
			method: 'PATCH',
			url: '/api/v1/activities/999/visibility',
			params: { id: '999' },
			body: { isVisible: false },
		});
		const res = await PATCH_VISIBILITY(event);
		expect(res.status).toBe(404);
	});

	it('isVisible が boolean でなければ 400', async () => {
		const event = createMockEvent({
			method: 'PATCH',
			url: '/api/v1/activities/1/visibility',
			params: { id: '1' },
			body: { isVisible: 'yes' },
		});
		const res = await PATCH_VISIBILITY(event);
		expect(res.status).toBe(400);
	});
});

// ===================================================================
// GET /api/v1/activities/:id
// ===================================================================
describe('GET /api/v1/activities/:id', () => {
	it('IDで活動を取得できる', async () => {
		const event = createMockEvent({
			url: '/api/v1/activities/1',
			params: { id: '1' },
		});
		const res = await GET_BY_ID(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.name).toBe('たいそう');
	});

	it('存在しないIDで 404', async () => {
		const event = createMockEvent({
			url: '/api/v1/activities/999',
			params: { id: '999' },
		});
		const res = await GET_BY_ID(event);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// DELETE /api/v1/activities/:id → ソフトデリート（非表示化）
// ===================================================================
describe('DELETE /api/v1/activities/:id', () => {
	it('活動を非表示にする (200)', async () => {
		const event = createMockEvent({
			method: 'DELETE',
			url: '/api/v1/activities/1',
			params: { id: '1' },
		});
		const res = await DELETE_BY_ID(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.message).toBe('非表示にしました');

		// 一覧から消えることを確認
		const listEvent = createMockEvent({ url: '/api/v1/activities' });
		const listRes = await GET(listEvent);
		const listBody = await listRes.json();
		expect(listBody.activities.find((a: Record<string, unknown>) => a.id === 1)).toBeUndefined();
	});
});

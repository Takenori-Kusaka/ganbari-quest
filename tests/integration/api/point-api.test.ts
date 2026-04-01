// tests/integration/api/point-api.test.ts
// ポイント管理API統合テスト (API-PNT-01 〜 API-PNT-06)

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
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);
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

// ハンドラのインポート
import { GET as GET_BALANCE } from '../../../src/routes/api/v1/points/[childId]/+server';
import { GET as GET_HISTORY } from '../../../src/routes/api/v1/points/[childId]/history/+server';
import { POST as POST_CONVERT } from '../../../src/routes/api/v1/points/convert/+server';

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
	sqlite.exec('DELETE FROM children');
	sqlite.exec("DELETE FROM sqlite_sequence WHERE name IN ('children','point_ledger')");
}

function seedChild() {
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4 }).run();
}

function addPoints(childId: number, amount: number, type: string, description: string) {
	testDb.insert(schema.pointLedger).values({ childId, amount, type, description }).run();
}

beforeEach(() => {
	resetDb();
	seedChild();
});

async function jsonBody(res: Response) {
	return res.json();
}

// ===================================================================
// API-PNT-01: GET /api/v1/points/:childId → ポイント残高取得
// ===================================================================
describe('API-PNT-01: GET /api/v1/points/:childId', () => {
	it('ポイント残高を取得できる (200)', async () => {
		addPoints(1, 100, 'activity', 'テスト活動');
		addPoints(1, 200, 'activity', 'テスト活動2');

		const event = createMockEvent({
			url: '/api/v1/points/1',
			params: { childId: '1' },
		});
		const res = await GET_BALANCE(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.childId).toBe(1);
		expect(body.balance).toBe(300);
		expect(body.convertableAmount).toBe(0); // 500未満
	});

	it('500P以上で convertableAmount が正しい', async () => {
		addPoints(1, 1250, 'activity', '大量ポイント');

		const event = createMockEvent({
			url: '/api/v1/points/1',
			params: { childId: '1' },
		});
		const res = await GET_BALANCE(event);
		const body = await jsonBody(res);

		expect(body.balance).toBe(1250);
		expect(body.convertableAmount).toBe(1000); // 500 * 2
	});

	it('初期状態は残高0', async () => {
		const event = createMockEvent({
			url: '/api/v1/points/1',
			params: { childId: '1' },
		});
		const res = await GET_BALANCE(event);
		const body = await jsonBody(res);

		expect(body.balance).toBe(0);
		expect(body.convertableAmount).toBe(0);
	});

	it('存在しない子供で 404', async () => {
		const event = createMockEvent({
			url: '/api/v1/points/999',
			params: { childId: '999' },
		});
		const res = await GET_BALANCE(event);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// API-PNT-02: GET /api/v1/points/:childId/history → ポイント履歴
// ===================================================================
describe('API-PNT-02: GET /api/v1/points/:childId/history', () => {
	it('ポイント履歴を取得できる (200)', async () => {
		addPoints(1, 100, 'activity', '活動1');
		addPoints(1, 200, 'activity', '活動2');
		addPoints(1, -50, 'cancel', 'キャンセル');

		const event = createMockEvent({
			url: '/api/v1/points/1/history',
			params: { childId: '1' },
		});
		const res = await GET_HISTORY(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.history).toHaveLength(3);
	});

	it('limit/offset が動作する', async () => {
		addPoints(1, 10, 'activity', '1');
		addPoints(1, 20, 'activity', '2');
		addPoints(1, 30, 'activity', '3');
		addPoints(1, 40, 'activity', '4');

		const event = createMockEvent({
			url: '/api/v1/points/1/history?limit=2&offset=1',
			params: { childId: '1' },
		});
		const res = await GET_HISTORY(event);
		const body = await jsonBody(res);

		expect(body.history).toHaveLength(2);
	});

	it('存在しない子供で 404', async () => {
		const event = createMockEvent({
			url: '/api/v1/points/999/history',
			params: { childId: '999' },
		});
		const res = await GET_HISTORY(event);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// API-PNT-03: POST /api/v1/points/convert → ポイント変換（正常）
// ===================================================================
describe('API-PNT-03: POST /api/v1/points/convert (normal)', () => {
	it('500Pを変換できる (200)', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 500 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.convertedAmount).toBe(500);
		expect(body.remainingBalance).toBe(200);
		expect(body.message).toContain('500ポイント');
	});

	it('1000P変換も動作する', async () => {
		addPoints(1, 1500, 'activity', '大量');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 1000 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.convertedAmount).toBe(1000);
		expect(body.remainingBalance).toBe(500);
	});

	it('変換後に残高が減っている', async () => {
		addPoints(1, 600, 'activity', 'テスト');

		const convertEvent = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 500 },
		});
		await POST_CONVERT(convertEvent);

		// 残高確認
		const balanceEvent = createMockEvent({
			url: '/api/v1/points/1',
			params: { childId: '1' },
		});
		const balanceRes = await GET_BALANCE(balanceEvent);
		const balanceBody = await jsonBody(balanceRes);
		expect(balanceBody.balance).toBe(100);
	});

	it('変換後に履歴にconvertが記録される', async () => {
		addPoints(1, 600, 'activity', 'テスト');

		const convertEvent = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 500 },
		});
		await POST_CONVERT(convertEvent);

		const histEvent = createMockEvent({
			url: '/api/v1/points/1/history',
			params: { childId: '1' },
		});
		const histRes = await GET_HISTORY(histEvent);
		const histBody = await jsonBody(histRes);

		const convertEntry = histBody.history.find(
			(h: Record<string, unknown>) => h.type === 'convert',
		);
		expect(convertEntry).toBeDefined();
		expect(convertEntry.amount).toBe(-500);
	});
});

// ===================================================================
// API-PNT-05: POST /api/v1/points/convert → 残高不足 (400)
// ===================================================================
describe('API-PNT-05: POST /api/v1/points/convert (insufficient)', () => {
	it('残高不足で INSUFFICIENT_POINTS エラー', async () => {
		addPoints(1, 300, 'activity', 'テスト');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 500 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(400);

		const body = await jsonBody(res);
		expect(body.error.code).toBe('INSUFFICIENT_POINTS');
	});

	it('残高0で変換不可', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 500 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(400);
	});

	it('存在しない子供で 404', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 999, amount: 500 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// API-PNT-03b: POST /api/v1/points/convert → 自由入力モード
// ===================================================================
describe('API-PNT-03b: POST /api/v1/points/convert (manual mode)', () => {
	it('手動入力で1P単位の変換ができる (200)', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 123, mode: 'manual' },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.convertedAmount).toBe(123);
		expect(body.remainingBalance).toBe(577);
		expect(body.message).toContain('手動入力');
	});

	it('領収書モードで変換できる (200)', async () => {
		addPoints(1, 1000, 'activity', 'テスト');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 648, mode: 'receipt' },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.convertedAmount).toBe(648);
		expect(body.message).toContain('領収書読み取り');
	});

	it('mode未指定はプリセットとして扱う（後方互換）', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 500 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.convertedAmount).toBe(500);
	});
});

// ===================================================================
// API-PNT-06: POST /api/v1/points/convert → 500P単位以外 (400)
// ===================================================================
describe('API-PNT-06: POST /api/v1/points/convert (invalid amount)', () => {
	it('300Pでバリデーションエラー (400)', async () => {
		addPoints(1, 1000, 'activity', 'テスト');

		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 300 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(400);

		const body = await jsonBody(res);
		expect(body.error.code).toBe('VALIDATION_ERROR');
	});

	it('0Pでバリデーションエラー', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: 0 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(400);
	});

	it('負の値でバリデーションエラー', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: { childId: 1, amount: -500 },
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(400);
	});

	it('bodyが空でバリデーションエラー', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/points/convert',
			body: {},
		});
		const res = await POST_CONVERT(event);
		expect(res.status).toBe(400);
	});
});

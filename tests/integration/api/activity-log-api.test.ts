// tests/integration/api/activity-log-api.test.ts
// 活動記録API統合テスト (API-LOG-01 〜 API-LOG-07)

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
	CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);
	CREATE INDEX idx_activity_logs_activity ON activity_logs(activity_id);
	CREATE INDEX idx_activity_logs_streak ON activity_logs(child_id, activity_id, recorded_date);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
		description TEXT, icon TEXT NOT NULL, category TEXT,
		condition_type TEXT NOT NULL, condition_value INTEGER NOT NULL,
		bonus_points INTEGER NOT NULL, rarity TEXT NOT NULL DEFAULT 'common',
		sort_order INTEGER NOT NULL DEFAULT 0,
		repeatable INTEGER NOT NULL DEFAULT 0,
		milestone_values TEXT,
		is_milestone INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE child_achievements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		achievement_id INTEGER NOT NULL REFERENCES achievements(id),
		milestone_value INTEGER,
		unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_child_achievements_unique
		ON child_achievements(child_id, achievement_id, milestone_value);
	CREATE TABLE statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id), total_xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, peak_xp INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category_id);
	CREATE TABLE status_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		category_id INTEGER NOT NULL REFERENCES categories(id), value REAL NOT NULL,
		change_amount REAL NOT NULL, change_type TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category_id, recorded_at);
	CREATE TABLE daily_missions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		mission_date TEXT NOT NULL,
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		completed INTEGER NOT NULL DEFAULT 0,
		completed_at TEXT,
		UNIQUE(child_id, mission_date, activity_id)
	);
	CREATE INDEX idx_daily_missions_child_date ON daily_missions(child_id, mission_date);
	CREATE TABLE activity_mastery (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES activities(id),
		total_count INTEGER NOT NULL DEFAULT 0,
		level INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE UNIQUE INDEX idx_activity_mastery_child_activity ON activity_mastery(child_id, activity_id);
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
import {
	GET as GET_LOGS,
	POST as POST_LOG,
} from '../../../src/routes/api/v1/activity-logs/+server';
import { DELETE as DELETE_LOG } from '../../../src/routes/api/v1/activity-logs/[id]/+server';

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
	sqlite.exec('DELETE FROM activity_mastery');
	sqlite.exec('DELETE FROM status_history');
	sqlite.exec('DELETE FROM statuses');
	sqlite.exec('DELETE FROM child_achievements');
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','activities','activity_logs','point_ledger','statuses','status_history','child_achievements','activity_mastery')",
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
}

beforeEach(() => {
	resetDb();
	seedBasic();
});

async function jsonBody(res: Response) {
	return res.json();
}

// ===================================================================
// API-LOG-01: POST /api/v1/activity-logs → 活動記録（正常、ストリーク情報含む）
// ===================================================================
describe('API-LOG-01: POST /api/v1/activity-logs (normal record)', () => {
	it('活動を記録でき、ストリーク情報が返る (201)', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		const res = await POST_LOG(event);
		expect(res.status).toBe(201);

		const body = await jsonBody(res);
		expect(body.childId).toBe(1);
		expect(body.activityId).toBe(1);
		expect(body.activityName).toBe('たいそう');
		expect(body.basePoints).toBe(5);
		expect(body.streakDays).toBe(1);
		expect(body.streakBonus).toBe(0);
		expect(body.totalPoints).toBe(5);
		expect(body.recordedAt).toBeDefined();
		expect(body.cancelableUntil).toBeDefined();
	});

	it('ポイント台帳にも記録される', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		await POST_LOG(event);

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.amount).toBe(5);
		expect(ledger[0]?.type).toBe('activity');
	});
});

// ===================================================================
// API-LOG-02: POST /api/v1/activity-logs → 同日重複記録 (409)
// ===================================================================
describe('API-LOG-02: POST /api/v1/activity-logs (duplicate)', () => {
	it('同日同活動の重複で 409 ALREADY_RECORDED', async () => {
		// 1回目
		const event1 = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		const res1 = await POST_LOG(event1);
		expect(res1.status).toBe(201);

		// 2回目（重複）
		const event2 = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		const res2 = await POST_LOG(event2);
		expect(res2.status).toBe(409);

		const body = await jsonBody(res2);
		expect(body.error.code).toBe('ALREADY_RECORDED');
	});

	it('別活動なら同日でも記録可能', async () => {
		const event1 = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		await POST_LOG(event1);

		const event2 = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 2 },
		});
		const res2 = await POST_LOG(event2);
		expect(res2.status).toBe(201);
	});
});

// ===================================================================
// API-LOG-03: POST /api/v1/activity-logs → バリデーションエラー (400)
// ===================================================================
describe('API-LOG-03: POST /api/v1/activity-logs (validation error)', () => {
	it('childId 欠落で 400', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { activityId: 1 },
		});
		const res = await POST_LOG(event);
		expect(res.status).toBe(400);
	});

	it('activityId 欠落で 400', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1 },
		});
		const res = await POST_LOG(event);
		expect(res.status).toBe(400);
	});

	it('存在しない childId で 404', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 999, activityId: 1 },
		});
		const res = await POST_LOG(event);
		expect(res.status).toBe(404);
	});

	it('存在しない activityId で 404', async () => {
		const event = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 999 },
		});
		const res = await POST_LOG(event);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// API-LOG-04: DELETE /api/v1/activity-logs/:id → キャンセル（5秒以内）
// ===================================================================
describe('API-LOG-04: DELETE /api/v1/activity-logs/:id (cancel within window)', () => {
	it('記録直後にキャンセルできる (200)', async () => {
		// 記録
		const postEvent = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		const postRes = await POST_LOG(postEvent);
		const postBody = await jsonBody(postRes);

		// 即キャンセル
		const deleteEvent = createMockEvent({
			method: 'DELETE',
			url: `/api/v1/activity-logs/${postBody.id}`,
			params: { id: String(postBody.id) },
		});
		const delRes = await DELETE_LOG(deleteEvent);
		expect(delRes.status).toBe(200);

		const delBody = await jsonBody(delRes);
		expect(delBody.refundedPoints).toBe(5);
		expect(delBody.message).toBe('記録をキャンセルしました');
	});

	it('キャンセル後はポイントが差し引かれる', async () => {
		const postEvent = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		const postRes = await POST_LOG(postEvent);
		const postBody = await jsonBody(postRes);

		const deleteEvent = createMockEvent({
			method: 'DELETE',
			url: `/api/v1/activity-logs/${postBody.id}`,
			params: { id: String(postBody.id) },
		});
		await DELETE_LOG(deleteEvent);

		const ledger = testDb.select().from(schema.pointLedger).all();
		const total = ledger.reduce((sum, e) => sum + e.amount, 0);
		expect(total).toBe(0); // +5 -5 = 0
	});
});

// ===================================================================
// API-LOG-05: DELETE /api/v1/activity-logs/:id → キャンセル期限超過 (400)
// ===================================================================
describe('API-LOG-05: DELETE /api/v1/activity-logs/:id (cancel expired)', () => {
	it('5秒超過後はキャンセル不可 (400)', async () => {
		// 古い記録を直接挿入 (10秒前)
		const pastTime = new Date(Date.now() - 10_000).toISOString();
		const today = new Date().toISOString().slice(0, 10);

		testDb
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: today,
				recordedAt: pastTime,
			})
			.run();

		const deleteEvent = createMockEvent({
			method: 'DELETE',
			url: '/api/v1/activity-logs/1',
			params: { id: '1' },
		});
		const res = await DELETE_LOG(deleteEvent);
		expect(res.status).toBe(400);

		const body = await jsonBody(res);
		expect(body.error.code).toBe('CANCEL_EXPIRED');
	});

	it('存在しない ID で 404', async () => {
		const deleteEvent = createMockEvent({
			method: 'DELETE',
			url: '/api/v1/activity-logs/999',
			params: { id: '999' },
		});
		const res = await DELETE_LOG(deleteEvent);
		expect(res.status).toBe(404);
	});
});

// ===================================================================
// API-LOG-06: GET /api/v1/activity-logs?childId=1 → ログ取得 (200)
// ===================================================================
describe('API-LOG-06: GET /api/v1/activity-logs?childId=1', () => {
	it('ログ一覧を取得できる (200)', async () => {
		// 記録を追加
		const postEvent = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		await POST_LOG(postEvent);

		const getEvent = createMockEvent({
			url: '/api/v1/activity-logs?childId=1',
		});
		const res = await GET_LOGS(getEvent);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.logs).toHaveLength(1);
		expect(body.logs[0].activityName).toBe('たいそう');
		expect(body.summary.totalCount).toBe(1);
		expect(body.summary.totalPoints).toBe(5);
	});

	it('キャンセル済はログに含まれない', async () => {
		// 記録してキャンセル
		const postEvent = createMockEvent({
			method: 'POST',
			url: '/api/v1/activity-logs',
			body: { childId: 1, activityId: 1 },
		});
		const postRes = await POST_LOG(postEvent);
		const postBody = await jsonBody(postRes);

		const deleteEvent = createMockEvent({
			method: 'DELETE',
			url: `/api/v1/activity-logs/${postBody.id}`,
			params: { id: String(postBody.id) },
		});
		await DELETE_LOG(deleteEvent);

		const getEvent = createMockEvent({
			url: '/api/v1/activity-logs?childId=1',
		});
		const res = await GET_LOGS(getEvent);
		const body = await jsonBody(res);
		expect(body.logs).toHaveLength(0);
		expect(body.summary.totalCount).toBe(0);
	});

	it('カテゴリ別集計が正しい', async () => {
		// 2つの活動を記録
		await POST_LOG(
			createMockEvent({
				method: 'POST',
				url: '/api/v1/activity-logs',
				body: { childId: 1, activityId: 1 },
			}),
		);
		await POST_LOG(
			createMockEvent({
				method: 'POST',
				url: '/api/v1/activity-logs',
				body: { childId: 1, activityId: 2 },
			}),
		);

		const getEvent = createMockEvent({
			url: '/api/v1/activity-logs?childId=1',
		});
		const res = await GET_LOGS(getEvent);
		const body = await jsonBody(res);

		expect(body.summary.totalCount).toBe(2);
		expect(body.summary.totalPoints).toBe(10);
		expect(body.summary.byCategory[1]).toEqual({ count: 1, points: 5 });
		expect(body.summary.byCategory[2]).toEqual({ count: 1, points: 5 });
	});
});

// ===================================================================
// API-LOG-07: GET /api/v1/activity-logs → childId 未指定 (400)
// ===================================================================
describe('API-LOG-07: GET /api/v1/activity-logs (missing childId)', () => {
	it('childId 未指定で 400', async () => {
		const event = createMockEvent({
			url: '/api/v1/activity-logs',
		});
		const res = await GET_LOGS(event);
		expect(res.status).toBe(400);

		const body = await jsonBody(res);
		expect(body.error.code).toBe('VALIDATION_ERROR');
	});
});

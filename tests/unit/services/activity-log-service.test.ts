// tests/unit/services/activity-log-service.test.ts
// 活動記録サービスのユニットテスト

import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcStreakBonus } from '../../../src/lib/domain/validation/activity';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle>;

// SQL for creating tables (same as schema.test.ts)
const CREATE_TABLES = `
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
		nickname TEXT NOT NULL,
		age INTEGER NOT NULL,
		birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		active_avatar_bg INTEGER,
		active_avatar_frame INTEGER,
		active_avatar_effect INTEGER,
		active_avatar_sound INTEGER,
		active_avatar_celebration INTEGER,
		display_config TEXT,
		user_id TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		category_id INTEGER NOT NULL REFERENCES categories(id),
		icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		age_min INTEGER,
		age_max INTEGER,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER,
		sort_order INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'seed',
		grade_level TEXT,
		subcategory TEXT,
		description TEXT,
		name_kana TEXT,
		name_kanji TEXT,
		trigger_hint TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
	CREATE INDEX idx_activity_logs_daily ON activity_logs(child_id, activity_id, recorded_date);
	CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL,
		type TEXT NOT NULL,
		description TEXT,
		reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
`;

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	sqlite.exec(CREATE_TABLES);
});

afterAll(() => {
	sqlite.close();
});

beforeEach(() => {
	// Clean tables
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec('DELETE FROM sqlite_sequence');

	// Insert test data
	db.insert(schema.children).values({ nickname: 'テスト子', age: 4 }).run();
	db.insert(schema.activities)
		.values({ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5 })
		.run();
	db.insert(schema.activities)
		.values({ name: 'えほん', categoryId: 2, icon: '📖', basePoints: 5 })
		.run();
});

describe('calcStreakBonus', () => {
	it('1日目はボーナスなし', () => {
		expect(calcStreakBonus(1)).toBe(0);
	});

	it('2日連続で+1ボーナス', () => {
		expect(calcStreakBonus(2)).toBe(1);
	});

	it('5日連続で+4ボーナス', () => {
		expect(calcStreakBonus(5)).toBe(4);
	});

	it('11日連続で上限+10ボーナス', () => {
		expect(calcStreakBonus(11)).toBe(10);
	});

	it('100日連続でも上限+10ボーナス', () => {
		expect(calcStreakBonus(100)).toBe(10);
	});

	it('0日はボーナスなし', () => {
		expect(calcStreakBonus(0)).toBe(0);
	});
});

describe('活動記録の挿入', () => {
	it('初回記録でstreakDays=1、ポイント付与', () => {
		const log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log.streakDays).toBe(1);
		expect(log.streakBonus).toBe(0);
		expect(log.cancelled).toBe(0);
	});

	it('同日同活動の複数記録が可能（dailyLimit制御はサービス層）', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log2.activityId).toBe(1);

		const logs = db.select().from(schema.activityLogs).all();
		expect(logs).toHaveLength(2);
	});

	it('別活動なら同日に記録可能', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 2,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log2.activityId).toBe(2);
	});

	it('別日なら同活動を記録可能', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 2,
				streakBonus: 1,
				recordedDate: '2026-02-21',
			})
			.returning()
			.get();

		expect(log2.streakDays).toBe(2);
		expect(log2.streakBonus).toBe(1);
	});
});

describe('連続日数の記録', () => {
	it('3日連続記録のstreakが正しい', () => {
		const dates = ['2026-02-18', '2026-02-19', '2026-02-20'];
		const expectedStreaks = [1, 2, 3];

		for (let i = 0; i < dates.length; i++) {
			db.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: 1,
					points: 5,
					streakDays: expectedStreaks[i]!,
					streakBonus: calcStreakBonus(expectedStreaks[i]!),
					recordedDate: dates[i]!,
				})
				.run();
		}

		const logs = db
			.select()
			.from(schema.activityLogs)
			.orderBy(schema.activityLogs.recordedDate)
			.all();

		expect(logs).toHaveLength(3);
		expect(logs[0]?.streakDays).toBe(1);
		expect(logs[0]?.streakBonus).toBe(0);
		expect(logs[1]?.streakDays).toBe(2);
		expect(logs[1]?.streakBonus).toBe(1);
		expect(logs[2]?.streakDays).toBe(3);
		expect(logs[2]?.streakBonus).toBe(2);
	});
});

describe('キャンセル', () => {
	it('キャンセルフラグを立てられる', () => {
		const _log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		db.update(schema.activityLogs).set({ cancelled: 1 }).run();

		const updated = db.select().from(schema.activityLogs).get();
		expect(updated?.cancelled).toBe(1);
	});

	it('キャンセル後も再記録が可能', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
				cancelled: 1,
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log2.cancelled).toBe(0);
	});
});

describe('ポイント台帳', () => {
	it('活動記録と同時にポイントが加算される', () => {
		const log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 3,
				streakBonus: 2,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		db.insert(schema.pointLedger)
			.values({
				childId: 1,
				amount: 7,
				type: 'activity',
				description: 'たいそう (3日連続+2)',
				referenceId: log.id,
			})
			.run();

		const ledger = db.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.amount).toBe(7);
		expect(ledger[0]?.type).toBe('activity');
	});

	it('キャンセルでマイナスポイントが記録される', () => {
		const log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		db.insert(schema.pointLedger)
			.values({ childId: 1, amount: 5, type: 'activity', referenceId: log.id })
			.run();

		db.insert(schema.pointLedger)
			.values({ childId: 1, amount: -5, type: 'cancel', referenceId: log.id })
			.run();

		const ledger = db.select().from(schema.pointLedger).all();
		const total = ledger.reduce((sum, e) => sum + e.amount, 0);
		expect(total).toBe(0);
	});
});

describe('dailyLimit（DB層テスト）', () => {
	it('dailyLimit=nullの活動はデフォルト値', () => {
		const activity = db.select().from(schema.activities).get();
		expect(activity?.dailyLimit).toBeNull();
	});

	it('dailyLimit=2の活動を作成・取得', () => {
		db.insert(schema.activities)
			.values({ name: 'はみがき', categoryId: 3, icon: '🪥', basePoints: 3, dailyLimit: 2 })
			.run();

		const activities = db.select().from(schema.activities).all();
		const hamigaki = activities.find((a) => a.name === 'はみがき');
		expect(hamigaki?.dailyLimit).toBe(2);
	});

	it('dailyLimit=0（無制限）の活動を作成・取得', () => {
		db.insert(schema.activities)
			.values({ name: 'おそうじ', categoryId: 3, icon: '🧹', basePoints: 3, dailyLimit: 0 })
			.run();

		const activities = db.select().from(schema.activities).all();
		const osouji = activities.find((a) => a.name === 'おそうじ');
		expect(osouji?.dailyLimit).toBe(0);
	});

	it('dailyLimit=2の活動で同日に2回記録が可能', () => {
		db.insert(schema.activities)
			.values({ name: 'はみがき2', categoryId: 3, icon: '🪥', basePoints: 3, dailyLimit: 2 })
			.run();

		const activities = db.select().from(schema.activities).all();
		const act = activities.find((a) => a.name === 'はみがき2')!;

		db.insert(schema.activityLogs)
			.values({ childId: 1, activityId: act.id, points: 3, recordedDate: '2026-02-20' })
			.run();
		db.insert(schema.activityLogs)
			.values({ childId: 1, activityId: act.id, points: 3, recordedDate: '2026-02-20' })
			.run();

		const logs = db
			.select()
			.from(schema.activityLogs)
			.where(
				and(
					eq(schema.activityLogs.activityId, act.id),
					eq(schema.activityLogs.recordedDate, '2026-02-20'),
				),
			)
			.all();
		expect(logs).toHaveLength(2);
	});
});

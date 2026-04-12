// tests/unit/db/schema.test.ts
// DBスキーマのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });

	// Create all tables from schema using drizzle-kit push equivalent
	// For in-memory testing, we manually create tables
	sqlite.exec(`
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
			is_main_quest INTEGER NOT NULL DEFAULT 0,
			is_archived INTEGER NOT NULL DEFAULT 0,
			archived_reason TEXT,
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
		CREATE INDEX idx_activity_logs_activity ON activity_logs(activity_id);
		CREATE INDEX idx_activity_logs_streak ON activity_logs(child_id, activity_id, recorded_date);

		CREATE TABLE point_ledger (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			amount INTEGER NOT NULL,
			type TEXT NOT NULL,
			description TEXT,
			reference_id INTEGER,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);

		CREATE TABLE statuses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			category_id INTEGER NOT NULL REFERENCES categories(id),
			total_xp INTEGER NOT NULL DEFAULT 0,
			level INTEGER NOT NULL DEFAULT 1,
			peak_xp INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			_sv INTEGER
		);
		CREATE UNIQUE INDEX idx_statuses_child_category ON statuses(child_id, category_id);

		CREATE TABLE status_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			category_id INTEGER NOT NULL REFERENCES categories(id),
			value REAL NOT NULL,
			change_amount REAL NOT NULL,
			change_type TEXT NOT NULL,
			recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX idx_status_history_child_cat ON status_history(child_id, category_id, recorded_at);

		CREATE TABLE evaluations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			week_start TEXT NOT NULL,
			week_end TEXT NOT NULL,
			scores_json TEXT NOT NULL,
			bonus_points INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE market_benchmarks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			age INTEGER NOT NULL,
			category_id INTEGER NOT NULL REFERENCES categories(id),
			mean REAL NOT NULL,
			std_dev REAL NOT NULL,
			source TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_benchmarks_age_category ON market_benchmarks(age, category_id);

		CREATE TABLE settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE character_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			type TEXT NOT NULL,
			file_path TEXT NOT NULL,
			prompt_hash TEXT,
			generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE login_bonuses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			child_id INTEGER NOT NULL REFERENCES children(id),
			login_date TEXT NOT NULL,
			rank TEXT NOT NULL,
			base_points INTEGER NOT NULL,
			multiplier REAL NOT NULL DEFAULT 1.0,
			total_points INTEGER NOT NULL,
			consecutive_days INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_login_bonuses_child_date ON login_bonuses(child_id, login_date);
	`);
});

afterAll(() => {
	sqlite.close();
});

describe('children テーブル', () => {
	it('子供を登録できる', () => {
		const result = db
			.insert(schema.children)
			.values({ nickname: 'テスト太郎', age: 4, theme: 'blue' })
			.returning()
			.get();

		expect(result.id).toBe(1);
		expect(result.nickname).toBe('テスト太郎');
		expect(result.age).toBe(4);
		expect(result.theme).toBe('blue');
		expect(result.createdAt).toBeTypeOf('string');
	});

	it('theme のデフォルト値が pink', () => {
		const result = db
			.insert(schema.children)
			.values({ nickname: 'テスト花子', age: 3 })
			.returning()
			.get();

		expect(result.theme).toBe('pink');
	});
});

describe('activities テーブル', () => {
	it('活動を登録できる', () => {
		const result = db
			.insert(schema.activities)
			.values({
				name: 'テスト活動',
				categoryId: 1,
				icon: '🏃',
				basePoints: 10,
			})
			.returning()
			.get();

		expect(result.id).toBe(1);
		expect(result.name).toBe('テスト活動');
		expect(result.basePoints).toBe(10);
		expect(result.isVisible).toBe(1);
	});
});

describe('activity_logs テーブル', () => {
	it('活動記録を登録できる', () => {
		const result = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(result.id).toBe(1);
		expect(result.streakDays).toBe(1);
		expect(result.streakBonus).toBe(0);
		expect(result.cancelled).toBe(0);
	});

	it('同じ日に同じ活動を複数回記録できる（dailyLimit対応）', () => {
		const result = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();
		expect(result.id).toBe(2);
	});

	it('別の日なら同じ活動を記録できる', () => {
		const result = db
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

		expect(result.streakDays).toBe(2);
		expect(result.streakBonus).toBe(1);
	});
});

describe('point_ledger テーブル', () => {
	it('ポイント記録を登録できる', () => {
		const result = db
			.insert(schema.pointLedger)
			.values({
				childId: 1,
				amount: 10,
				type: 'activity',
				description: 'テスト活動の記録',
				referenceId: 1,
			})
			.returning()
			.get();

		expect(result.amount).toBe(10);
		expect(result.type).toBe('activity');
	});
});

describe('statuses テーブル', () => {
	it('ステータスを登録できる', () => {
		const result = db
			.insert(schema.statuses)
			.values({ childId: 1, categoryId: 1, totalXp: 30, level: 2, peakXp: 30 })
			.returning()
			.get();

		expect(result.totalXp).toBe(30);
		expect(result.level).toBe(2);
		expect(result.peakXp).toBe(30);
	});

	it('同じ子供・カテゴリの組み合わせはユニーク制約違反', () => {
		expect(() => {
			db.insert(schema.statuses)
				.values({ childId: 1, categoryId: 1, totalXp: 50, level: 3, peakXp: 50 })
				.run();
		}).toThrow();
	});
});

describe('status_history テーブル', () => {
	it('ステータス変動履歴を登録できる', () => {
		const result = db
			.insert(schema.statusHistory)
			.values({
				childId: 1,
				categoryId: 1,
				value: 31.0,
				changeAmount: 1.0,
				changeType: 'activity',
			})
			.returning()
			.get();

		expect(result.changeAmount).toBe(1.0);
	});
});

describe('evaluations テーブル', () => {
	it('週次評価を登録できる', () => {
		const result = db
			.insert(schema.evaluations)
			.values({
				childId: 1,
				weekStart: '2026-02-17',
				weekEnd: '2026-02-23',
				scoresJson: JSON.stringify({ うんどう: 4, べんきょう: 3 }),
				bonusPoints: 5,
			})
			.returning()
			.get();

		expect(result.bonusPoints).toBe(5);
		expect(JSON.parse(result.scoresJson)).toHaveProperty('うんどう', 4);
	});
});

describe('market_benchmarks テーブル', () => {
	it('ベンチマークを登録できる', () => {
		const result = db
			.insert(schema.marketBenchmarks)
			.values({
				age: 4,
				categoryId: 1,
				mean: 30.0,
				stdDev: 10.0,
				source: 'テスト',
			})
			.returning()
			.get();

		expect(result.mean).toBe(30.0);
		expect(result.stdDev).toBe(10.0);
	});

	it('同じ年齢・カテゴリの組み合わせはユニーク制約違反', () => {
		expect(() => {
			db.insert(schema.marketBenchmarks)
				.values({ age: 4, categoryId: 1, mean: 40.0, stdDev: 5.0 })
				.run();
		}).toThrow();
	});
});

describe('settings テーブル', () => {
	it('設定を登録できる', () => {
		const result = db
			.insert(schema.settings)
			.values({ key: 'test_key', value: 'test_value' })
			.returning()
			.get();

		expect(result.key).toBe('test_key');
		expect(result.value).toBe('test_value');
	});
});

describe('character_images テーブル', () => {
	it('キャラクター画像を登録できる', () => {
		const result = db
			.insert(schema.characterImages)
			.values({
				childId: 1,
				type: 'hero',
				filePath: '/images/hero_001.png',
				promptHash: 'abc123',
			})
			.returning()
			.get();

		expect(result.type).toBe('hero');
		expect(result.filePath).toBe('/images/hero_001.png');
	});
});

describe('login_bonuses テーブル', () => {
	it('ログインボーナスを登録できる', () => {
		const result = db
			.insert(schema.loginBonuses)
			.values({
				childId: 1,
				loginDate: '2026-02-20',
				rank: '大吉',
				basePoints: 10,
				multiplier: 1.0,
				totalPoints: 10,
				consecutiveDays: 1,
			})
			.returning()
			.get();

		expect(result.rank).toBe('大吉');
		expect(result.totalPoints).toBe(10);
	});

	it('同じ日に2回ログインボーナスを受け取れない', () => {
		expect(() => {
			db.insert(schema.loginBonuses)
				.values({
					childId: 1,
					loginDate: '2026-02-20',
					rank: '小吉',
					basePoints: 5,
					multiplier: 1.0,
					totalPoints: 5,
					consecutiveDays: 1,
				})
				.run();
		}).toThrow();
	});

	it('連続ログインの倍率が正しく保存される', () => {
		const result = db
			.insert(schema.loginBonuses)
			.values({
				childId: 1,
				loginDate: '2026-02-21',
				rank: '中吉',
				basePoints: 7,
				multiplier: 1.5,
				totalPoints: 11,
				consecutiveDays: 3,
			})
			.returning()
			.get();

		expect(result.multiplier).toBe(1.5);
		expect(result.consecutiveDays).toBe(3);
		expect(result.totalPoints).toBe(11);
	});
});

describe('外部キー制約', () => {
	it('存在しない子供IDでの活動記録はエラー', () => {
		expect(() => {
			db.insert(schema.activityLogs)
				.values({
					childId: 999,
					activityId: 1,
					points: 5,
					recordedDate: '2026-02-20',
				})
				.run();
		}).toThrow();
	});

	it('存在しない活動IDでの活動記録はエラー', () => {
		expect(() => {
			db.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: 999,
					points: 5,
					recordedDate: '2026-02-22',
				})
				.run();
		}).toThrow();
	});
});

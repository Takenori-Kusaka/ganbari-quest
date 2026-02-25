// src/lib/server/db/seed.ts
// 初期データ投入スクリプト
// Usage: npx tsx src/lib/server/db/seed.ts

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL ?? './data/ganbari-quest.db';

const sqlite = new Database(DATABASE_URL);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite, { schema });

function seed() {
	console.log('Seeding database...');

	// ============================================================
	// 初期子供データ
	// ============================================================
	const existingChildren = db.select().from(schema.children).all();
	if (existingChildren.length === 0) {
		db.insert(schema.children)
			.values({
				nickname: 'おじょうさま',
				age: 4,
				theme: 'pink',
				uiMode: 'kinder',
			})
			.run();
		console.log('  ✓ children: おじょうさま (4歳, kinder)');
	} else {
		console.log('  - children: already seeded');
	}

	// ============================================================
	// 初期活動マスタ（15件）
	// ============================================================
	const existingActivities = db.select().from(schema.activities).all();
	if (existingActivities.length === 0) {
		const activitiesData: (typeof schema.activities.$inferInsert)[] = [
			// うんどう
			{
				name: 'たいそうした',
				category: 'うんどう',
				icon: '🤸',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
				sortOrder: 1,
			},
			{
				name: 'おそとであそんだ',
				category: 'うんどう',
				icon: '🏃',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
				sortOrder: 2,
			},
			{
				name: 'すいみんぐ',
				category: 'うんどう',
				icon: '🏊',
				basePoints: 10,
				ageMin: 3,
				ageMax: null,
				sortOrder: 3,
			},
			// べんきょう
			{
				name: 'ひらがなれんしゅう',
				category: 'べんきょう',
				icon: '✏️',
				basePoints: 5,
				ageMin: 3,
				ageMax: null,
				sortOrder: 4,
			},
			{
				name: 'すうじをかぞえた',
				category: 'べんきょう',
				icon: '🔢',
				basePoints: 5,
				ageMin: 3,
				ageMax: null,
				sortOrder: 5,
			},
			{
				name: 'えほんをよんだ',
				category: 'べんきょう',
				icon: '📖',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
				sortOrder: 6,
			},
			{
				name: 'としょかんにいった',
				category: 'べんきょう',
				icon: '🏛️',
				basePoints: 10,
				ageMin: null,
				ageMax: null,
				sortOrder: 7,
			},
			// そうぞう
			{
				name: 'おえかきした',
				category: 'そうぞう',
				icon: '🎨',
				basePoints: 5,
				ageMin: null,
				ageMax: null,
				sortOrder: 8,
			},
			{
				name: 'こうさくした',
				category: 'そうぞう',
				icon: '✂️',
				basePoints: 5,
				ageMin: 3,
				ageMax: null,
				sortOrder: 9,
			},
			// せいかつ
			{
				name: 'おきがえした',
				category: 'せいかつ',
				icon: '👗',
				basePoints: 3,
				ageMin: 3,
				ageMax: null,
				sortOrder: 10,
			},
			{
				name: 'はみがきした',
				category: 'せいかつ',
				icon: '🪥',
				basePoints: 3,
				ageMin: null,
				ageMax: null,
				sortOrder: 11,
			},
			{
				name: 'ごはんをぜんぶたべた',
				category: 'せいかつ',
				icon: '🍚',
				basePoints: 3,
				ageMin: 1,
				ageMax: 6,
				sortOrder: 12,
			},
			// こうりゅう
			{
				name: 'ともだちとあそんだ',
				category: 'こうりゅう',
				icon: '🤝',
				basePoints: 5,
				ageMin: 3,
				ageMax: null,
				sortOrder: 13,
			},
			{
				name: 'あいさつした',
				category: 'こうりゅう',
				icon: '👋',
				basePoints: 3,
				ageMin: null,
				ageMax: null,
				sortOrder: 14,
			},
			{
				name: 'はっぴょうかいでがんばった',
				category: 'こうりゅう',
				icon: '🎤',
				basePoints: 20,
				ageMin: 3,
				ageMax: null,
				sortOrder: 15,
			},
		];

		db.insert(schema.activities).values(activitiesData).run();
		console.log(`  ✓ activities: ${activitiesData.length} items`);
	} else {
		console.log('  - activities: already seeded');
	}

	// ============================================================
	// 初期市場ベンチマーク（4歳児・暫定値）
	// ============================================================
	const existingBenchmarks = db.select().from(schema.marketBenchmarks).all();
	if (existingBenchmarks.length === 0) {
		const benchmarksData: (typeof schema.marketBenchmarks.$inferInsert)[] = [
			{ age: 4, category: 'うんどう', mean: 30.0, stdDev: 10.0, source: '暫定値' },
			{ age: 4, category: 'べんきょう', mean: 20.0, stdDev: 8.0, source: '暫定値' },
			{ age: 4, category: 'せいかつ', mean: 35.0, stdDev: 8.0, source: '暫定値' },
			{ age: 4, category: 'こうりゅう', mean: 25.0, stdDev: 10.0, source: '暫定値' },
			{ age: 4, category: 'そうぞう', mean: 25.0, stdDev: 9.0, source: '暫定値' },
		];

		db.insert(schema.marketBenchmarks).values(benchmarksData).run();
		console.log(`  ✓ market_benchmarks: ${benchmarksData.length} items`);
	} else {
		console.log('  - market_benchmarks: already seeded');
	}

	// ============================================================
	// 初期ステータス（おじょうさま・市場平均値で初期化）
	// ============================================================
	const existingStatuses = db.select().from(schema.statuses).all();
	if (existingStatuses.length === 0) {
		const statusesData: (typeof schema.statuses.$inferInsert)[] = [
			{ childId: 1, category: 'うんどう', value: 30.0 },
			{ childId: 1, category: 'べんきょう', value: 20.0 },
			{ childId: 1, category: 'せいかつ', value: 35.0 },
			{ childId: 1, category: 'こうりゅう', value: 25.0 },
			{ childId: 1, category: 'そうぞう', value: 25.0 },
		];

		db.insert(schema.statuses).values(statusesData).run();
		console.log(`  ✓ statuses: ${statusesData.length} items`);
	} else {
		console.log('  - statuses: already seeded');
	}

	// ============================================================
	// 初期実績マスタ（12件）
	// ============================================================
	const existingAchievements = db.select().from(schema.achievements).all();
	if (existingAchievements.length === 0) {
		const achievementsData: (typeof schema.achievements.$inferInsert)[] = [
			{
				code: 'first_activity',
				name: 'はじめてのきろく',
				description: 'はじめてかつどうをきろくした！',
				icon: '🌟',
				category: null,
				conditionType: 'total_activities',
				conditionValue: 1,
				bonusPoints: 10,
				rarity: 'common',
				sortOrder: 1,
			},
			{
				code: 'streak_3',
				name: '3にちれんぞく',
				description: '3にちれんぞくでかつどうした！',
				icon: '🔥',
				category: null,
				conditionType: 'streak_days',
				conditionValue: 3,
				bonusPoints: 20,
				rarity: 'common',
				sortOrder: 2,
			},
			{
				code: 'streak_7',
				name: '7にちれんぞく',
				description: '1しゅうかんれんぞくでかつどうした！',
				icon: '💪',
				category: null,
				conditionType: 'streak_days',
				conditionValue: 7,
				bonusPoints: 50,
				rarity: 'rare',
				sortOrder: 3,
			},
			{
				code: 'streak_30',
				name: '30にちれんぞく',
				description: '1かげつれんぞくでかつどうした！',
				icon: '👑',
				category: null,
				conditionType: 'streak_days',
				conditionValue: 30,
				bonusPoints: 200,
				rarity: 'epic',
				sortOrder: 4,
			},
			{
				code: 'activities_10',
				name: '10かいきろく',
				description: '10かいかつどうをきろくした！',
				icon: '📝',
				category: null,
				conditionType: 'total_activities',
				conditionValue: 10,
				bonusPoints: 30,
				rarity: 'common',
				sortOrder: 5,
			},
			{
				code: 'activities_50',
				name: '50かいきろく',
				description: '50かいかつどうをきろくした！',
				icon: '📚',
				category: null,
				conditionType: 'total_activities',
				conditionValue: 50,
				bonusPoints: 100,
				rarity: 'rare',
				sortOrder: 6,
			},
			{
				code: 'activities_100',
				name: '100かいきろく',
				description: '100かいかつどうをきろくした！',
				icon: '🏆',
				category: null,
				conditionType: 'total_activities',
				conditionValue: 100,
				bonusPoints: 300,
				rarity: 'epic',
				sortOrder: 7,
			},
			{
				code: 'all_categories',
				name: 'ぜんぶのカテゴリ',
				description: '1にちですべてのカテゴリをきろくした！',
				icon: '🌈',
				category: null,
				conditionType: 'all_categories',
				conditionValue: 1,
				bonusPoints: 50,
				rarity: 'rare',
				sortOrder: 8,
			},
			{
				code: 'level_5',
				name: 'レベル5とうたつ',
				description: 'レベル5になった！',
				icon: '⭐',
				category: null,
				conditionType: 'level_reach',
				conditionValue: 5,
				bonusPoints: 100,
				rarity: 'rare',
				sortOrder: 9,
			},
			{
				code: 'level_10',
				name: 'さいきょうレベル',
				description: 'レベル10になった！すごい！',
				icon: '💎',
				category: null,
				conditionType: 'level_reach',
				conditionValue: 10,
				bonusPoints: 500,
				rarity: 'legendary',
				sortOrder: 10,
			},
			{
				code: 'points_100',
				name: '100ポイントたっせい',
				description: 'ごうけい100ポイントたまった！',
				icon: '💰',
				category: null,
				conditionType: 'total_points',
				conditionValue: 100,
				bonusPoints: 30,
				rarity: 'common',
				sortOrder: 11,
			},
			{
				code: 'points_1000',
				name: '1000ポイントたっせい',
				description: 'ごうけい1000ポイントたまった！',
				icon: '🤑',
				category: null,
				conditionType: 'total_points',
				conditionValue: 1000,
				bonusPoints: 200,
				rarity: 'epic',
				sortOrder: 12,
			},
		];

		db.insert(schema.achievements).values(achievementsData).run();
		console.log(`  ✓ achievements: ${achievementsData.length} items`);
	} else {
		console.log('  - achievements: already seeded');
	}

	// ============================================================
	// 初期設定（PIN認証用）
	// ============================================================
	const existingSettings = db.select().from(schema.settings).all();
	if (existingSettings.length === 0) {
		const defaultPinHash = bcrypt.hashSync('1234', 10);
		db.insert(schema.settings)
			.values([
				{ key: 'pin_hash', value: defaultPinHash },
				{ key: 'session_token', value: '' },
				{ key: 'session_expires_at', value: '' },
				{ key: 'pin_failed_attempts', value: '0' },
				{ key: 'pin_locked_until', value: '' },
			])
			.run();
		console.log('  ✓ settings: PIN auth defaults (デフォルトPIN: 1234)');
	} else {
		console.log('  - settings: already seeded');
	}

	// ============================================================
	// 特別報酬テンプレート（settingsにJSON保存）
	// ============================================================
	const existingTemplates = db
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, 'reward_templates'))
		.get();
	if (!existingTemplates) {
		const templates = [
			{ title: 'テスト100てん', points: 100, icon: '🎓', category: 'academic' },
			{ title: 'しかくごうかく', points: 200, icon: '📜', category: 'academic' },
			{ title: 'うんどうかい1い', points: 150, icon: '🏆', category: 'sports' },
			{ title: 'はっぴょうかいがんばった', points: 100, icon: '🎤', category: 'social' },
			{ title: 'さくひんにゅうしょう', points: 150, icon: '🎨', category: 'creative' },
			{ title: 'おてつだいありがとう', points: 50, icon: '🙏', category: 'life' },
		];
		db.insert(schema.settings)
			.values({ key: 'reward_templates', value: JSON.stringify(templates) })
			.run();
		console.log(`  ✓ reward_templates: ${templates.length} templates`);
	} else {
		console.log('  - reward_templates: already seeded');
	}

	console.log('Seeding complete!');
}

seed();
sqlite.close();

// tests/helpers/test-db.ts
// テスト用インメモリ SQLite + Drizzle セットアップ

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SQL_CREATE_TABLES } from '../../src/lib/server/db/create-tables';
import * as schema from '../../src/lib/server/db/schema';

export function createTestDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_CREATE_TABLES);
	const db = drizzle(sqlite, { schema });
	return { sqlite, db, schema };
}

/** テスト用の認証設定を挿入する */
export function seedAuthSettings(db: ReturnType<typeof drizzle>, pinHash: string) {
	db.insert(schema.settings)
		.values([
			{ key: 'pin_hash', value: pinHash },
			{ key: 'session_token', value: '' },
			{ key: 'session_expires_at', value: '' },
			{ key: 'pin_failed_attempts', value: '0' },
			{ key: 'pin_locked_until', value: '' },
		])
		.run();
}

/** テスト用の子供と活動を挿入する */
export function seedTestData(db: ReturnType<typeof drizzle>) {
	// 子供
	db.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();

	// 活動マスタ
	const activitiesData = [
		{ name: 'たいそうした', categoryId: 1, icon: '🤸', basePoints: 5, sortOrder: 1 },
		{ name: 'おそとであそんだ', categoryId: 1, icon: '🏃', basePoints: 5, sortOrder: 2 },
		{
			name: 'すいみんぐ',
			categoryId: 1,
			icon: '🏊',
			basePoints: 10,
			ageMin: 3,
			sortOrder: 3,
		},
		{
			name: 'ひらがなれんしゅう',
			categoryId: 2,
			icon: '✏️',
			basePoints: 5,
			ageMin: 3,
			sortOrder: 4,
		},
		{ name: 'おかたづけした', categoryId: 3, icon: '🧹', basePoints: 5, sortOrder: 5 },
		{ name: 'おえかきした', categoryId: 5, icon: '🎨', basePoints: 5, sortOrder: 6 },
		{
			name: 'おともだちとあそんだ',
			categoryId: 4,
			icon: '🤝',
			basePoints: 5,
			sortOrder: 7,
		},
		{
			name: '5さいいじょう活動',
			categoryId: 2,
			icon: '📚',
			basePoints: 5,
			ageMin: 5,
			sortOrder: 8,
		},
		{
			name: '非表示活動',
			categoryId: 1,
			icon: '❌',
			basePoints: 5,
			isVisible: 0,
			sortOrder: 99,
		},
	];

	for (const a of activitiesData) {
		db.insert(schema.activities).values(a).run();
	}

	return {
		childId: 1,
		activityIds: {
			taisou: 1,
			osoto: 2,
			swimming: 3,
			hiragana: 4,
			okataduke: 5,
			oekaki: 6,
			otomodachi: 7,
			fiveAndUp: 8,
			hidden: 9,
		},
	};
}

// src/lib/server/db/schema.ts
// がんばりクエスト Drizzle ORM スキーマ定義
// See: docs/design/08-データベース設計書.md

import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// children - 子供マスタ
// ============================================================
export const children = sqliteTable('children', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	nickname: text('nickname').notNull(),
	age: integer('age').notNull(),
	birthDate: text('birth_date'),
	theme: text('theme').notNull().default('pink'),
	createdAt: text('created_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// activities - 活動マスタ
// ============================================================
export const activities = sqliteTable('activities', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	category: text('category').notNull(),
	icon: text('icon').notNull(),
	basePoints: integer('base_points').notNull().default(5),
	ageMin: integer('age_min'),
	ageMax: integer('age_max'),
	isVisible: integer('is_visible').notNull().default(1),
	dailyLimit: integer('daily_limit'),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: text('created_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// activity_logs - 活動記録
// ============================================================
export const activityLogs = sqliteTable(
	'activity_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		activityId: integer('activity_id')
			.notNull()
			.references(() => activities.id),
		points: integer('points').notNull(),
		streakDays: integer('streak_days').notNull().default(1),
		streakBonus: integer('streak_bonus').notNull().default(0),
		recordedDate: text('recorded_date').notNull(),
		recordedAt: text('recorded_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		cancelled: integer('cancelled').notNull().default(0),
	},
	(table) => [
		uniqueIndex('idx_activity_logs_unique_daily').on(
			table.childId,
			table.activityId,
			table.recordedDate,
		),
		index('idx_activity_logs_child_date').on(
			table.childId,
			table.recordedDate,
		),
		index('idx_activity_logs_activity').on(table.activityId),
		index('idx_activity_logs_streak').on(
			table.childId,
			table.activityId,
			table.recordedDate,
		),
	],
);

// ============================================================
// point_ledger - ポイント台帳
// ============================================================
export const pointLedger = sqliteTable(
	'point_ledger',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		amount: integer('amount').notNull(),
		type: text('type').notNull(),
		description: text('description'),
		referenceId: integer('reference_id'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_point_ledger_child').on(table.childId, table.createdAt),
	],
);

// ============================================================
// statuses - 現在ステータス
// ============================================================
export const statuses = sqliteTable(
	'statuses',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		category: text('category').notNull(),
		value: real('value').notNull().default(0.0),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_statuses_child_category').on(
			table.childId,
			table.category,
		),
	],
);

// ============================================================
// status_history - ステータス変動履歴
// ============================================================
export const statusHistory = sqliteTable(
	'status_history',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		category: text('category').notNull(),
		value: real('value').notNull(),
		changeAmount: real('change_amount').notNull(),
		changeType: text('change_type').notNull(),
		recordedAt: text('recorded_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_status_history_child_cat').on(
			table.childId,
			table.category,
			table.recordedAt,
		),
	],
);

// ============================================================
// evaluations - 週次評価
// ============================================================
export const evaluations = sqliteTable('evaluations', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	childId: integer('child_id')
		.notNull()
		.references(() => children.id),
	weekStart: text('week_start').notNull(),
	weekEnd: text('week_end').notNull(),
	scoresJson: text('scores_json').notNull(),
	bonusPoints: integer('bonus_points').notNull().default(0),
	createdAt: text('created_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// market_benchmarks - 市場ベンチマーク
// ============================================================
export const marketBenchmarks = sqliteTable(
	'market_benchmarks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		age: integer('age').notNull(),
		category: text('category').notNull(),
		mean: real('mean').notNull(),
		stdDev: real('std_dev').notNull(),
		source: text('source'),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_benchmarks_age_category').on(table.age, table.category),
	],
);

// ============================================================
// settings - システム設定（KVS）
// ============================================================
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// character_images - キャラクター画像
// ============================================================
export const characterImages = sqliteTable('character_images', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	childId: integer('child_id')
		.notNull()
		.references(() => children.id),
	type: text('type').notNull(),
	filePath: text('file_path').notNull(),
	promptHash: text('prompt_hash'),
	generatedAt: text('generated_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// login_bonuses - ログインボーナス
// ============================================================
export const loginBonuses = sqliteTable(
	'login_bonuses',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		loginDate: text('login_date').notNull(),
		rank: text('rank').notNull(),
		basePoints: integer('base_points').notNull(),
		multiplier: real('multiplier').notNull().default(1.0),
		totalPoints: integer('total_points').notNull(),
		consecutiveDays: integer('consecutive_days').notNull().default(1),
		createdAt: text('created_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_login_bonuses_child_date').on(
			table.childId,
			table.loginDate,
		),
	],
);

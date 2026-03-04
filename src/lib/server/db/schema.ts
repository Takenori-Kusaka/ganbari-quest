// src/lib/server/db/schema.ts
// がんばりクエスト Drizzle ORM スキーマ定義
// See: docs/design/08-データベース設計書.md

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ============================================================
// children - 子供マスタ
// ============================================================
export const children = sqliteTable('children', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	nickname: text('nickname').notNull(),
	age: integer('age').notNull(),
	birthDate: text('birth_date'),
	theme: text('theme').notNull().default('pink'),
	uiMode: text('ui_mode').notNull().default('kinder'),
	avatarUrl: text('avatar_url'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
	source: text('source').notNull().default('seed'),
	gradeLevel: text('grade_level'),
	subcategory: text('subcategory'),
	description: text('description'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
		recordedAt: text('recorded_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		cancelled: integer('cancelled').notNull().default(0),
	},
	(table) => [
		index('idx_activity_logs_daily').on(
			table.childId,
			table.activityId,
			table.recordedDate,
		),
		index('idx_activity_logs_child_date').on(table.childId, table.recordedDate),
		index('idx_activity_logs_activity').on(table.activityId),
		index('idx_activity_logs_streak').on(table.childId, table.activityId, table.recordedDate),
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
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_point_ledger_child').on(table.childId, table.createdAt)],
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
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_statuses_child_category').on(table.childId, table.category)],
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
		recordedAt: text('recorded_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_status_history_child_cat').on(table.childId, table.category, table.recordedAt),
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
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_benchmarks_age_category').on(table.age, table.category)],
);

// ============================================================
// settings - システム設定（KVS）
// ============================================================
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
	generatedAt: text('generated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_login_bonuses_child_date').on(table.childId, table.loginDate)],
);

// ============================================================
// achievements - 実績マスタ
// ============================================================
export const achievements = sqliteTable('achievements', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	description: text('description'),
	icon: text('icon').notNull(),
	category: text('category'),
	conditionType: text('condition_type').notNull(),
	conditionValue: integer('condition_value').notNull(),
	bonusPoints: integer('bonus_points').notNull(),
	rarity: text('rarity').notNull().default('common'),
	sortOrder: integer('sort_order').notNull().default(0),
	repeatable: integer('repeatable').notNull().default(0),
	milestoneValues: text('milestone_values'),
	isMilestone: integer('is_milestone').notNull().default(0),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// child_achievements - 実績解除履歴
// ============================================================
export const childAchievements = sqliteTable(
	'child_achievements',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		achievementId: integer('achievement_id')
			.notNull()
			.references(() => achievements.id),
		milestoneValue: integer('milestone_value'),
		unlockedAt: text('unlocked_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_child_achievements_unique').on(
			table.childId,
			table.achievementId,
			table.milestoneValue,
		),
	],
);

// ============================================================
// special_rewards - 特別報酬
// ============================================================
export const specialRewards = sqliteTable(
	'special_rewards',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		grantedBy: integer('granted_by'),
		title: text('title').notNull(),
		description: text('description'),
		points: integer('points').notNull(),
		icon: text('icon'),
		category: text('category').notNull(),
		grantedAt: text('granted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_special_rewards_child').on(table.childId, table.grantedAt)],
);

// ============================================================
// checklist_templates - チェックリストテンプレート
// ============================================================
export const checklistTemplates = sqliteTable('checklist_templates', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	childId: integer('child_id')
		.notNull()
		.references(() => children.id),
	name: text('name').notNull(),
	icon: text('icon').notNull().default('📋'),
	pointsPerItem: integer('points_per_item').notNull().default(2),
	completionBonus: integer('completion_bonus').notNull().default(5),
	isActive: integer('is_active').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// checklist_template_items - チェックリストアイテム
// ============================================================
export const checklistTemplateItems = sqliteTable(
	'checklist_template_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		templateId: integer('template_id')
			.notNull()
			.references(() => checklistTemplates.id),
		name: text('name').notNull(),
		icon: text('icon').notNull().default('🏫'),
		frequency: text('frequency').notNull().default('daily'),
		direction: text('direction').notNull().default('bring'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_checklist_items_template').on(table.templateId)],
);

// ============================================================
// checklist_logs - チェックリスト日次記録
// ============================================================
export const checklistLogs = sqliteTable(
	'checklist_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		templateId: integer('template_id')
			.notNull()
			.references(() => checklistTemplates.id),
		checkedDate: text('checked_date').notNull(),
		itemsJson: text('items_json').notNull().default('[]'),
		completedAll: integer('completed_all').notNull().default(0),
		pointsAwarded: integer('points_awarded').notNull().default(0),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_checklist_logs_unique_daily').on(
			table.childId,
			table.templateId,
			table.checkedDate,
		),
	],
);

// ============================================================
// checklist_overrides - 日付別アイテム追加/除外
// ============================================================
export const checklistOverrides = sqliteTable(
	'checklist_overrides',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		targetDate: text('target_date').notNull(),
		action: text('action').notNull(),
		itemName: text('item_name').notNull(),
		icon: text('icon').notNull().default('📦'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_checklist_overrides_child_date').on(table.childId, table.targetDate)],
);

// src/lib/server/db/schema.ts
// がんばりクエスト Drizzle ORM スキーマ定義
// See: docs/design/08-データベース設計書.md

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ============================================================
// categories - カテゴリマスタ
// ============================================================
export const categories = sqliteTable('categories', {
	id: integer('id').primaryKey(),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	icon: text('icon'),
	color: text('color'),
});

// ============================================================
// titles - 称号マスタ
// ============================================================
export const titles = sqliteTable('titles', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	description: text('description'),
	icon: text('icon').notNull(),
	conditionType: text('condition_type').notNull(),
	conditionValue: integer('condition_value').notNull(),
	conditionExtra: text('condition_extra'),
	rarity: text('rarity').notNull().default('common'),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
	activeTitleId: integer('active_title_id'),
	activeAvatarBg: integer('active_avatar_bg'),
	activeAvatarFrame: integer('active_avatar_frame'),
	activeAvatarEffect: integer('active_avatar_effect'),
	activeAvatarSound: integer('active_avatar_sound'),
	activeAvatarCelebration: integer('active_avatar_celebration'),
	displayConfig: text('display_config'),
	userId: text('user_id'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// activities - 活動マスタ
// ============================================================
export const activities = sqliteTable('activities', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	categoryId: integer('category_id')
		.notNull()
		.references(() => categories.id),
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
	nameKana: text('name_kana'),
	nameKanji: text('name_kanji'),
	triggerHint: text('trigger_hint'),
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
		index('idx_activity_logs_daily').on(table.childId, table.activityId, table.recordedDate),
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
		categoryId: integer('category_id')
			.notNull()
			.references(() => categories.id),
		value: real('value').notNull().default(0.0),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_statuses_child_category').on(table.childId, table.categoryId)],
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
		categoryId: integer('category_id')
			.notNull()
			.references(() => categories.id),
		value: real('value').notNull(),
		changeAmount: real('change_amount').notNull(),
		changeType: text('change_type').notNull(),
		recordedAt: text('recorded_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_status_history_child_cat').on(table.childId, table.categoryId, table.recordedAt),
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
		categoryId: integer('category_id')
			.notNull()
			.references(() => categories.id),
		mean: real('mean').notNull(),
		stdDev: real('std_dev').notNull(),
		source: text('source'),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_benchmarks_age_category').on(table.age, table.categoryId)],
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
// rest_days - おやすみ日（ステータス減少停止）
// ============================================================
export const restDays = sqliteTable(
	'rest_days',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		date: text('date').notNull(),
		reason: text('reason').notNull().default('rest'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_rest_days_child_date').on(table.childId, table.date)],
);

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
		shownAt: text('shown_at'),
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

// ============================================================
// birthday_reviews - 誕生日振り返り記録
// ============================================================
export const birthdayReviews = sqliteTable(
	'birthday_reviews',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		reviewYear: integer('review_year').notNull(),
		ageAtReview: integer('age_at_review').notNull(),
		healthChecks: text('health_checks').notNull().default('{}'),
		aspirationText: text('aspiration_text'),
		aspirationCategories: text('aspiration_categories').notNull().default('{}'),
		basePoints: integer('base_points').notNull().default(0),
		healthPoints: integer('health_points').notNull().default(0),
		aspirationPoints: integer('aspiration_points').notNull().default(0),
		totalPoints: integer('total_points').notNull().default(0),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_birthday_reviews_unique').on(table.childId, table.reviewYear)],
);

// ============================================================
// dailyMissions - デイリーミッション
// ============================================================
export const dailyMissions = sqliteTable(
	'daily_missions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		missionDate: text('mission_date').notNull(),
		activityId: integer('activity_id')
			.notNull()
			.references(() => activities.id),
		completed: integer('completed').notNull().default(0),
		completedAt: text('completed_at'),
	},
	(table) => [
		uniqueIndex('idx_daily_missions_unique').on(table.childId, table.missionDate, table.activityId),
		index('idx_daily_missions_child_date').on(table.childId, table.missionDate),
	],
);

// ============================================================
// avatar_items - きせかえアイテムマスタ
// ============================================================
export const avatarItems = sqliteTable('avatar_items', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	description: text('description'),
	category: text('category').notNull(), // 'background' | 'frame' | 'effect'
	icon: text('icon').notNull(),
	cssValue: text('css_value').notNull(),
	price: integer('price').notNull().default(0),
	unlockType: text('unlock_type').notNull().default('purchase'), // 'purchase' | 'level' | 'achievement' | 'free'
	unlockCondition: text('unlock_condition'), // JSON: { level: 5 } etc.
	rarity: text('rarity').notNull().default('common'),
	sortOrder: integer('sort_order').notNull().default(0),
	isActive: integer('is_active').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// child_avatar_items - きせかえアイテム所持
// ============================================================
export const childAvatarItems = sqliteTable(
	'child_avatar_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		avatarItemId: integer('avatar_item_id')
			.notNull()
			.references(() => avatarItems.id),
		acquiredAt: text('acquired_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_child_avatar_items_unique').on(table.childId, table.avatarItemId)],
);

// ============================================================
// child_titles - 称号解除履歴
// ============================================================
export const childTitles = sqliteTable(
	'child_titles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		titleId: integer('title_id')
			.notNull()
			.references(() => titles.id),
		unlockedAt: text('unlocked_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_child_titles_unique').on(table.childId, table.titleId)],
);

// ============================================================
// career_fields - 職業分野マスタ
// ============================================================
export const careerFields = sqliteTable('career_fields', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	description: text('description'),
	icon: text('icon'),
	relatedCategories: text('related_categories').notNull().default('[]'),
	recommendedActivities: text('recommended_activities').notNull().default('[]'),
	minAge: integer('min_age').notNull().default(6),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// career_plans - キャリアプラン
// ============================================================
export const careerPlans = sqliteTable(
	'career_plans',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		careerFieldId: integer('career_field_id').references(() => careerFields.id),
		dreamText: text('dream_text'),
		mandalaChart: text('mandala_chart').notNull().default('{}'),
		timeline3y: text('timeline_3y'),
		timeline5y: text('timeline_5y'),
		timeline10y: text('timeline_10y'),
		targetStatuses: text('target_statuses').notNull().default('{}'),
		version: integer('version').notNull().default(1),
		isActive: integer('is_active').notNull().default(1),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_career_plans_child').on(table.childId, table.isActive)],
);

// ============================================================
// career_plan_history - プラン更新履歴
// ============================================================
export const careerPlanHistory = sqliteTable(
	'career_plan_history',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		careerPlanId: integer('career_plan_id')
			.notNull()
			.references(() => careerPlans.id),
		action: text('action').notNull(),
		pointsEarned: integer('points_earned').notNull().default(0),
		snapshot: text('snapshot').notNull().default('{}'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_career_plan_history_plan').on(table.careerPlanId)],
);

// ============================================================
// child_activity_preferences - 子供×活動のピン留め設定
// ============================================================
export const childActivityPreferences = sqliteTable(
	'child_activity_preferences',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		activityId: integer('activity_id')
			.notNull()
			.references(() => activities.id, { onDelete: 'cascade' }),
		isPinned: integer('is_pinned').notNull().default(0),
		pinOrder: integer('pin_order'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_child_activity_prefs_unique').on(table.childId, table.activityId),
		index('idx_child_activity_prefs_child').on(table.childId),
		index('idx_child_activity_prefs_pinned').on(table.childId, table.isPinned),
	],
);

// ============================================================
// stamp_masters - スタンプマスタ
// ============================================================
export const stampMasters = sqliteTable('stamp_masters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	emoji: text('emoji').notNull(),
	rarity: text('rarity').notNull(), // 'N' | 'R' | 'SR' | 'UR'
	isDefault: integer('is_default').notNull().default(1),
	isEnabled: integer('is_enabled').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// stamp_cards - スタンプカード（週単位、子供ごと）
// ============================================================
export const stampCards = sqliteTable(
	'stamp_cards',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		weekStart: text('week_start').notNull(),
		weekEnd: text('week_end').notNull(),
		status: text('status').notNull().default('collecting'), // 'collecting' | 'redeemable' | 'redeemed'
		redeemedPoints: integer('redeemed_points'),
		redeemedAt: text('redeemed_at'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_stamp_cards_child_week').on(table.childId, table.weekStart),
		index('idx_stamp_cards_child').on(table.childId),
	],
);

// ============================================================
// stamp_entries - スタンプ押印記録
// ============================================================
export const stampEntries = sqliteTable(
	'stamp_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		cardId: integer('card_id')
			.notNull()
			.references(() => stampCards.id, { onDelete: 'cascade' }),
		stampMasterId: integer('stamp_master_id')
			.notNull()
			.references(() => stampMasters.id),
		slot: integer('slot').notNull(),
		loginDate: text('login_date').notNull(),
		earnedAt: text('earned_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_stamp_entries_card_slot').on(table.cardId, table.slot),
		uniqueIndex('idx_stamp_entries_card_date').on(table.cardId, table.loginDate),
	],
);

// ============================================================
// skill_nodes - パッシブスキルノードマスタ
// ============================================================
export const skillNodes = sqliteTable('skill_nodes', {
	id: integer('id').primaryKey(),
	categoryId: integer('category_id').references(() => categories.id),
	name: text('name').notNull(),
	description: text('description'),
	icon: text('icon').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
	spCost: integer('sp_cost').notNull().default(1),
	requiredNodeId: integer('required_node_id'),
	requiredCategoryLevel: integer('required_category_level').notNull().default(0),
	effectType: text('effect_type').notNull(),
	effectValue: real('effect_value').notNull(),
	targetModes: text('target_modes').notNull().default('["lower","upper","teen"]'),
});

// ============================================================
// child_skill_nodes - 子供別スキルノード解放状態
// ============================================================
export const childSkillNodes = sqliteTable(
	'child_skill_nodes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		nodeId: integer('node_id')
			.notNull()
			.references(() => skillNodes.id),
		unlockedAt: text('unlocked_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_child_skill_nodes_unique').on(table.childId, table.nodeId)],
);

// ============================================================
// skill_points - スキルポイント残高
// ============================================================
export const skillPoints = sqliteTable(
	'skill_points',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		balance: integer('balance').notNull().default(0),
		totalEarned: integer('total_earned').notNull().default(0),
		totalSpent: integer('total_spent').notNull().default(0),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_skill_points_child').on(table.childId)],
);

// ============================================================
// activity_mastery - 活動別習熟度
// ============================================================
export const activityMastery = sqliteTable(
	'activity_mastery',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		activityId: integer('activity_id')
			.notNull()
			.references(() => activities.id),
		totalCount: integer('total_count').notNull().default(0),
		level: integer('level').notNull().default(1),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_activity_mastery_child_activity').on(table.childId, table.activityId),
	],
);

// ============================================================
// child_custom_voices - 親の声・カスタム音声
// ============================================================
export const childCustomVoices = sqliteTable(
	'child_custom_voices',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id').notNull(),
		scene: text('scene').notNull().default('complete'),
		label: text('label').notNull(),
		filePath: text('file_path').notNull(),
		publicUrl: text('public_url').notNull(),
		durationMs: integer('duration_ms'),
		isActive: integer('is_active').notNull().default(0),
		tenantId: text('tenant_id').notNull(),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_child_custom_voices_child').on(table.childId, table.scene)],
);

// ============================================================
// parent_messages - 親から子へのおうえんメッセージ
// ============================================================
export const parentMessages = sqliteTable(
	'parent_messages',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		messageType: text('message_type').notNull(), // 'stamp' | 'text' | 'reward_notice'
		stampCode: text('stamp_code'), // スタンプ種別コード（stampの場合）
		body: text('body'), // 自由入力テキスト（textの場合）
		icon: text('icon').notNull().default('💌'),
		sentAt: text('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		shownAt: text('shown_at'), // 子供に表示済みの日時
	},
	(table) => [
		index('idx_parent_messages_child').on(table.childId, table.sentAt),
		index('idx_parent_messages_unshown').on(table.childId, table.shownAt),
	],
);

// ============================================================
// level_titles - テナント別レベル称号カスタマイズ
// ============================================================
export const levelTitles = sqliteTable(
	'level_titles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		level: integer('level').notNull(),
		customTitle: text('custom_title').notNull(),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [uniqueIndex('idx_level_titles_tenant_level').on(table.tenantId, table.level)],
);

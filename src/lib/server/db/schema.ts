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
	displayConfig: text('display_config'),
	userId: text('user_id'),
	birthdayBonusMultiplier: real('birthday_bonus_multiplier').notNull().default(1.0),
	lastBirthdayBonusYear: integer('last_birthday_bonus_year'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	_sv: integer('_sv'),
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
		totalXp: integer('total_xp').notNull().default(0),
		level: integer('level').notNull().default(1),
		peakXp: integer('peak_xp').notNull().default(0),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		_sv: integer('_sv'),
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
		stampMasterId: integer('stamp_master_id').references(() => stampMasters.id),
		omikujiRank: text('omikuji_rank'),
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
// season_events - シーズンイベント定義
// ============================================================
export const seasonEvents = sqliteTable('season_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code').notNull().unique(),
	name: text('name').notNull(),
	description: text('description'),
	eventType: text('event_type').notNull().default('seasonal'), // seasonal / campaign / monthly
	startDate: text('start_date').notNull(), // YYYY-MM-DD
	endDate: text('end_date').notNull(), // YYYY-MM-DD
	bannerIcon: text('banner_icon').notNull().default('🎉'),
	bannerColor: text('banner_color'), // CSS color or gradient
	themeConfig: text('theme_config'), // JSON: background, accent colors
	rewardConfig: text('reward_config'), // JSON: title/points/stamp rewards
	missionConfig: text('mission_config'), // JSON: event-specific missions
	isActive: integer('is_active').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// child_event_progress - 子供ごとのイベント参加・進捗
// ============================================================
export const childEventProgress = sqliteTable(
	'child_event_progress',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		eventId: integer('event_id')
			.notNull()
			.references(() => seasonEvents.id),
		status: text('status').notNull().default('active'), // active / completed / reward_claimed
		progressJson: text('progress_json'), // JSON: mission completions, counts
		rewardClaimedAt: text('reward_claimed_at'),
		joinedAt: text('joined_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_child_event_unique').on(table.childId, table.eventId),
		index('idx_child_event_child').on(table.childId),
	],
);

// ============================================================
// sibling_challenges - きょうだいチャレンジ定義
// ============================================================
export const siblingChallenges = sqliteTable(
	'sibling_challenges',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		title: text('title').notNull(),
		description: text('description'),
		challengeType: text('challenge_type').notNull().default('cooperative'), // cooperative | competitive
		periodType: text('period_type').notNull().default('weekly'), // weekly | monthly | custom
		startDate: text('start_date').notNull(), // YYYY-MM-DD
		endDate: text('end_date').notNull(), // YYYY-MM-DD
		targetConfig: text('target_config').notNull(), // JSON: { metric, categoryId?, baseTarget, ageAdjustments? }
		rewardConfig: text('reward_config').notNull(), // JSON: { points, message? }
		status: text('status').notNull().default('active'), // active | completed | expired
		isActive: integer('is_active').notNull().default(1),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_sibling_challenges_status').on(table.status),
		index('idx_sibling_challenges_dates').on(table.startDate, table.endDate),
	],
);

// ============================================================
// sibling_challenge_progress - 子供ごとのチャレンジ進捗
// ============================================================
export const siblingChallengeProgress = sqliteTable(
	'sibling_challenge_progress',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		challengeId: integer('challenge_id')
			.notNull()
			.references(() => siblingChallenges.id, { onDelete: 'cascade' }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		currentValue: integer('current_value').notNull().default(0),
		targetValue: integer('target_value').notNull(),
		completed: integer('completed').notNull().default(0),
		completedAt: text('completed_at'),
		rewardClaimed: integer('reward_claimed').notNull().default(0),
		rewardClaimedAt: text('reward_claimed_at'),
		progressJson: text('progress_json'), // JSON: detailed tracking
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_sibling_challenge_progress_unique').on(table.challengeId, table.childId),
		index('idx_sibling_challenge_progress_child').on(table.childId),
	],
);

// ============================================================
// sibling_cheers - きょうだい間おうえんスタンプ
// ============================================================
export const siblingCheers = sqliteTable(
	'sibling_cheers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		fromChildId: integer('from_child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		toChildId: integer('to_child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		stampCode: text('stamp_code').notNull(),
		tenantId: text('tenant_id').notNull().default('default'),
		sentAt: text('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		shownAt: text('shown_at'),
	},
	(table) => [index('idx_sibling_cheers_to_shown').on(table.toChildId, table.shownAt)],
);

// ============================================================
// push_subscriptions - プッシュ通知購読
// ============================================================
export const pushSubscriptions = sqliteTable(
	'push_subscriptions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		endpoint: text('endpoint').notNull().unique(),
		keysP256dh: text('keys_p256dh').notNull(),
		keysAuth: text('keys_auth').notNull(),
		userAgent: text('user_agent'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_push_subs_tenant').on(table.tenantId)],
);

// ============================================================
// notification_logs - 通知送信ログ（レート制限＋監査）
// ============================================================
export const notificationLogs = sqliteTable(
	'notification_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		notificationType: text('notification_type').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		sentAt: text('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		success: integer('success').notNull().default(1),
		errorMessage: text('error_message'),
	},
	(table) => [index('idx_notification_logs_tenant_date').on(table.tenantId, table.sentAt)],
);

export const reportDailySummaries = sqliteTable(
	'report_daily_summaries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		date: text('date').notNull(),
		activityCount: integer('activity_count').notNull().default(0),
		categoryBreakdown: text('category_breakdown').notNull().default('{}'),
		checklistCompletion: text('checklist_completion').notNull().default('{}'),
		level: integer('level').notNull().default(1),
		totalPoints: integer('total_points').notNull().default(0),
		streakDays: integer('streak_days').notNull().default(0),
		newAchievements: integer('new_achievements').notNull().default(0),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_report_daily_child_date').on(table.childId, table.date),
		index('idx_report_daily_tenant_date').on(table.tenantId, table.date),
	],
);

// ============================================================
// Certificates
// ============================================================

// ============================================================
// custom_achievements - カスタム実績
// ============================================================
export const customAchievements = sqliteTable(
	'custom_achievements',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		name: text('name').notNull(),
		description: text('description'),
		icon: text('icon').notNull().default('🏅'),
		conditionType: text('condition_type').notNull(), // total_count, activity_count, category_count, streak_days, activity_streak
		conditionActivityId: integer('condition_activity_id'), // for activity_count / activity_streak
		conditionCategoryId: integer('condition_category_id'), // for category_count
		conditionValue: integer('condition_value').notNull(), // target value
		bonusPoints: integer('bonus_points').notNull().default(100),
		unlockedAt: text('unlocked_at'), // null = not yet unlocked
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_custom_achievements_tenant_child').on(table.tenantId, table.childId)],
);

// ============================================================
// certificates - がんばり証明書
// ============================================================
export const certificates = sqliteTable(
	'certificates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		tenantId: text('tenant_id').notNull(),
		certificateType: text('certificate_type').notNull(),
		title: text('title').notNull(),
		description: text('description'),
		issuedAt: text('issued_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		metadata: text('metadata'),
	},
	(table) => [
		uniqueIndex('idx_certificates_child_type').on(
			table.childId,
			table.tenantId,
			table.certificateType,
		),
	],
);

// ============================================================
// cloud_exports - クラウドエクスポート共有（PIN付きS3保管）
// ============================================================
export const cloudExports = sqliteTable(
	'cloud_exports',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		exportType: text('export_type').notNull(), // 'template' | 'full'
		pinCode: text('pin_code').notNull().unique(),
		s3Key: text('s3_key').notNull(),
		fileSizeBytes: integer('file_size_bytes').notNull(),
		label: text('label'),
		description: text('description'),
		expiresAt: text('expires_at').notNull(),
		downloadCount: integer('download_count').notNull().default(0),
		maxDownloads: integer('max_downloads').notNull().default(10),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_cloud_exports_tenant').on(table.tenantId),
		index('idx_cloud_exports_pin').on(table.pinCode),
	],
);

// ============================================================
// tenant_events - テナント別シーズンイベント有効/無効
// ============================================================
export const tenantEvents = sqliteTable(
	'tenant_events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		eventCode: text('event_code').notNull(),
		year: integer('year').notNull(),
		enabled: integer('enabled').notNull().default(1),
		targetOverride: text('target_override'), // JSON: override missions
		rewardMemo: text('reward_memo'), // parent's reward promise
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_tenant_events_unique').on(table.tenantId, table.eventCode, table.year),
		index('idx_tenant_events_tenant_year').on(table.tenantId, table.year),
	],
);

// ============================================================
// tenant_event_progress - テナントイベントの子供別進捗
// ============================================================
export const tenantEventProgress = sqliteTable(
	'tenant_event_progress',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		eventCode: text('event_code').notNull(),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		year: integer('year').notNull(),
		currentCount: integer('current_count').notNull().default(0),
		completedAt: text('completed_at'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_tenant_event_progress_unique').on(
			table.tenantId,
			table.eventCode,
			table.childId,
			table.year,
		),
		index('idx_tenant_event_progress_child').on(table.childId, table.year),
	],
);

// ============================================================
// auto_challenges - 自動生成ウィークリーチャレンジ
// ============================================================
export const autoChallenges = sqliteTable(
	'auto_challenges',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		tenantId: text('tenant_id').notNull(),
		weekStart: text('week_start').notNull(), // YYYY-MM-DD (Monday)
		categoryId: integer('category_id')
			.notNull()
			.references(() => categories.id),
		targetCount: integer('target_count').notNull(),
		currentCount: integer('current_count').notNull().default(0),
		status: text('status').notNull().default('active'), // active | completed | expired
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_auto_challenges_child_week').on(table.childId, table.weekStart),
		index('idx_auto_challenges_tenant').on(table.tenantId),
		index('idx_auto_challenges_status').on(table.status),
	],
);

// ============================================================
// trial_history - トライアル履歴（#314）
// ============================================================
export const trialHistory = sqliteTable(
	'trial_history',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		startDate: text('start_date').notNull(), // YYYY-MM-DD
		endDate: text('end_date').notNull(), // YYYY-MM-DD
		tier: text('tier').notNull().default('standard'), // 'standard' | 'family'
		source: text('source').notNull(), // 'user_initiated' | 'campaign' | 'admin_grant'
		campaignId: text('campaign_id'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_trial_history_tenant').on(table.tenantId)],
);

// ============================================================
// viewer_tokens - 閲覧専用リンクトークン (#371)
// ============================================================
export const viewerTokens = sqliteTable(
	'viewer_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		token: text('token').notNull().unique(),
		label: text('label'), // e.g. "おばあちゃん用"
		expiresAt: text('expires_at'), // null = 無期限
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		revokedAt: text('revoked_at'),
	},
	(table) => [
		index('idx_viewer_tokens_tenant').on(table.tenantId),
		uniqueIndex('idx_viewer_tokens_token').on(table.token),
	],
);

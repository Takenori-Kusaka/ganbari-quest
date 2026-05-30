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
	uiMode: text('ui_mode').notNull().default('preschool'),
	uiModeManuallySet: integer('ui_mode_manually_set').notNull().default(0),
	avatarUrl: text('avatar_url'),
	displayConfig: text('display_config'),
	userId: text('user_id'),
	birthdayBonusMultiplier: real('birthday_bonus_multiplier').notNull().default(1.0),
	lastBirthdayBonusYear: integer('last_birthday_bonus_year'),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	_sv: integer('_sv'),
	// #783: トライアル終了時の超過リソース archive
	isArchived: integer('is_archived').notNull().default(0),
	// Phase 7 PR-1 (#2685): enum 制約 (`{ enum: ARCHIVED_REASONS }`) は Phase 7 PR-2a で
	// 既存 sqlite/dynamodb/demo repo 4 file の `reason: string` → `reason: ArchivedReason`
	// 型強制 (atom 統合) と同時に適用する。本 PR は expand 段階で code 変更ゼロ原則のため、
	// DB 列定義は `text('archived_reason')` のままで domain SSOT (`archive-types.ts`) のみ配備。
	// SSOT: `src/lib/domain/archive-types.ts`
	archivedReason: text('archived_reason'),
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
	isMainQuest: integer('is_main_quest').notNull().default(0),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	// #783: トライアル終了時の超過リソース archive
	isArchived: integer('is_archived').notNull().default(0),
	// Phase 7 PR-1 (#2685): enum 制約 (`{ enum: ARCHIVED_REASONS }`) は Phase 7 PR-2a で
	// 既存 sqlite/dynamodb/demo repo 4 file の `reason: string` → `reason: ArchivedReason`
	// 型強制 (atom 統合) と同時に適用する。本 PR は expand 段階で code 変更ゼロ原則のため、
	// DB 列定義は `text('archived_reason')` のままで domain SSOT (`archive-types.ts`) のみ配備。
	// SSOT: `src/lib/domain/archive-types.ts`
	archivedReason: text('archived_reason'),
	// #1254 G1: マーケットプレイスプリセット由来の識別子（import 時の preset_duplicate 検知に利用）
	sourcePresetId: text('source_preset_id'),
	// #1755 (#1709-A): 「今日のおやくそく」優先度 — 'must' = 今日のおやくそく / 'optional' = ふつうの活動
	// 既存レコードは backfill で 'optional' を設定する（global-setup.ts / migrate-local.ts / 本番マイグレーション）
	priority: text('priority', { enum: ['must', 'optional'] })
		.notNull()
		.default('optional'),
});

// ============================================================
// child_activities - per-child 活動 instance (#2362 PR-3、ADR-0055)
// ============================================================
// 旧 `activities` を per-child instance 化する refactor の第 1 段階として、
// 並存 table として作成。次 phase で旧 `activities` を drop + FK 全切替を行う。
// 設計 SSOT: docs/design/data-model-resource-scope.md §4.1
export const childActivities = sqliteTable(
	'child_activities',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		categoryId: integer('category_id')
			.notNull()
			.references(() => categories.id),
		icon: text('icon').notNull(),
		basePoints: integer('base_points').notNull().default(5),
		isVisible: integer('is_visible').notNull().default(1),
		dailyLimit: integer('daily_limit'),
		sortOrder: integer('sort_order').notNull().default(0),
		source: text('source').notNull().default('seed'),
		nameKana: text('name_kana'),
		nameKanji: text('name_kanji'),
		triggerHint: text('trigger_hint'),
		isMainQuest: integer('is_main_quest').notNull().default(0),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		isArchived: integer('is_archived').notNull().default(0),
		// Phase 7 PR-1 (#2685): enum 制約 (`{ enum: ARCHIVED_REASONS }`) は Phase 7 PR-2a で
		// 既存 sqlite/dynamodb/demo repo 4 file の `reason: string` → `reason: ArchivedReason`
		// 型強制 (atom 統合) と同時に適用する。本 PR は expand 段階で code 変更ゼロ原則のため、
		// DB 列定義は `text('archived_reason')` のままで domain SSOT (`archive-types.ts`) のみ配備。
		// SSOT: `src/lib/domain/archive-types.ts`
		archivedReason: text('archived_reason'),
		sourcePresetId: text('source_preset_id'),
		priority: text('priority', { enum: ['must', 'optional'] })
			.notNull()
			.default('optional'),
	},
	(table) => [
		index('idx_child_activities_child').on(table.childId, table.isArchived),
		index('idx_child_activities_child_sort').on(table.childId, table.sortOrder),
	],
);

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
		// #2362 PR-3 (Phase 7b-2a): FK target を child_activities へ切替
		// 旧 activities table は drop しない (#2458 別 PR)、並存維持
		activityId: integer('activity_id')
			.notNull()
			.references(() => childActivities.id),
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
		// #1254 G1: プリセット由来のごほうびを識別（import 時の preset_duplicate 検知に利用）
		sourcePresetId: text('source_preset_id'),
	},
	(table) => [index('idx_special_rewards_child').on(table.childId, table.grantedAt)],
);

// ============================================================
// reward_redemption_requests - ごほうびショップ交換申請 (#1337)
// ============================================================
export const rewardRedemptionRequests = sqliteTable(
	'reward_redemption_requests',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		rewardId: integer('reward_id')
			.notNull()
			.references(() => specialRewards.id),
		requestedAt: integer('requested_at').notNull(),
		status: text('status').notNull().default('pending_parent_approval'),
		parentNote: text('parent_note'),
		resolvedAt: integer('resolved_at'),
		resolvedByParentId: integer('resolved_by_parent_id'),
		shownToChildAt: integer('shown_to_child_at'),
	},
	(table) => [
		index('idx_redemption_requests_child_status').on(table.childId, table.status),
		index('idx_redemption_requests_reward_status').on(table.rewardId, table.status),
	],
);

// ============================================================
// checklist_templates - 持ち物チェックリスト family master template
// ============================================================
// #2362 PR-5 (ADR-0055 / data-model-resource-scope §4.2):
//   per-child instance (旧 childId NOT NULL) → family master 化。
//   childId 列を削除し tenantId scope のみで一意化。配信先 child の N:M binding は
//   `checklist_template_assignments` (新規) で表現する。
//   per-child progress は既存 `checklist_logs` (childId × templateId × date UNIQUE) を維持。
export const checklistTemplates = sqliteTable('checklist_templates', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	// #2362 PR-5: tenant scope (family master) を物理 column 化。
	//   SQLite 単一テナント運用時は固定値 'default' を入れる (`scripts/migrate-local.ts` で backfill)。
	//   DynamoDB 実装では PK の tenant プレフィクスで暗黙保持されるが、コードからは tenantId 引数で渡す。
	tenantId: text('tenant_id').notNull().default('default'),
	name: text('name').notNull(),
	icon: text('icon').notNull().default('📋'),
	pointsPerItem: integer('points_per_item').notNull().default(2),
	completionBonus: integer('completion_bonus').notNull().default(5),
	timeSlot: text('time_slot').notNull().default('anytime'),
	isActive: integer('is_active').notNull().default(1),
	createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	// #783: トライアル終了時の超過リソース archive
	isArchived: integer('is_archived').notNull().default(0),
	// Phase 7 PR-1 (#2685): enum 制約 (`{ enum: ARCHIVED_REASONS }`) は Phase 7 PR-2a で
	// 既存 sqlite/dynamodb/demo repo 4 file の `reason: string` → `reason: ArchivedReason`
	// 型強制 (atom 統合) と同時に適用する。本 PR は expand 段階で code 変更ゼロ原則のため、
	// DB 列定義は `text('archived_reason')` のままで domain SSOT (`archive-types.ts`) のみ配備。
	// SSOT: `src/lib/domain/archive-types.ts`
	archivedReason: text('archived_reason'),
	// #1755 (#1709-A): kind 列削除 — 持ち物純化（旧 'routine' は activities.priority='must' に役割移管）
	// #1254 G1: マーケットプレイスプリセット由来の識別子（import 時の preset_duplicate 検知に利用）
	sourcePresetId: text('source_preset_id'),
});

// ============================================================
// checklist_template_assignments - family checklist ↔ child 配信先 binding (#2362 PR-5)
// ============================================================
// 1 つの family checklist (`checklist_templates`) を複数 child に「配信」する N:M relation。
// 配信解除 = row 削除、配信先追加 = row 追加。`checklist_logs` の per-child progress は
// 本 table と独立 (logs は (childId, templateId, date) で UNIQUE)。
//
// SSOT: docs/design/data-model-resource-scope.md §4.2
export const checklistTemplateAssignments = sqliteTable(
	'checklist_template_assignments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		templateId: integer('template_id')
			.notNull()
			.references(() => checklistTemplates.id),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_checklist_template_assignments_unique').on(table.templateId, table.childId),
		index('idx_checklist_template_assignments_child').on(table.childId),
	],
);

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
		// #2362 PR-3 (Phase 7b-2a): FK target を child_activities へ切替
		activityId: integer('activity_id')
			.notNull()
			.references(() => childActivities.id),
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
		// #2362 PR-3 (Phase 7b-2a): FK target を child_activities へ切替
		activityId: integer('activity_id')
			.notNull()
			.references(() => childActivities.id, { onDelete: 'cascade' }),
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
		// #2362 PR-3 (Phase 7b-2a): FK target を child_activities へ切替
		activityId: integer('activity_id')
			.notNull()
			.references(() => childActivities.id),
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
		// #2267 (EPIC #2266): 応援機能 (cheer) で付与したボーナスポイント。reward_notice タイプのみで使用。
		// NULL = 旧 stamp / text メッセージ（cheer P 付与なし）
		bonusPoints: integer('bonus_points'),
		// #2267 (EPIC #2266): 応援機能 (cheer) のカテゴリ (うんどう/べんきょう/せいかつ/こうりゅう/そうぞう/とくべつ)。
		// reward_notice タイプのみで使用。NULL = カテゴリ未指定 or 旧 stamp / text。
		rewardCategory: text('reward_category'),
	},
	(table) => [
		index('idx_parent_messages_child').on(table.childId, table.sentAt),
		index('idx_parent_messages_unshown').on(table.childId, table.shownAt),
	],
);

// #2295 (EPIC #2294 ①): season_events / child_event_progress テーブル削除済 (2026-05-19)
// Research 2 段階で「シーズン機能はコア wedge を補強せず、ADR-0012 anti-engagement + ADR-0013 LP truth 二重違反」と確定。
// 自動配信ロジック皆無 (設計書 §11.1 記述だけ放置)、業界事例ゼロのため完全撤去。
// 並行実装ペア (sqlite / demo / dynamodb repo / service / UI / test fixtures) も同期削除。

// ============================================================
// child_challenges - per-child チャレンジ instance (#2362 PR-7、ADR-0055、User §6)
// ============================================================
// 旧 `sibling_challenges` / `sibling_challenge_progress` (family-wide + 別 progress table) を
// per-child instance に flip した refactor。旧 table は #2458 (PR #2488 caller migrate +
// 本 PR で物理 drop) で完全撤去済。
//
// User §6: 「兄弟にこだわりすぎないほうが…子供別 challenge セット + 共通化コントロールで
// 兄弟チャレンジに魅せる」方針。
//
// 兄弟連動 UI は同じ source preset / 同じタイトル / 同じ期間で複数 child instance が
// 作成された場合、admin/challenges 画面で sourceTemplateId による group 表示で比較する。
//
// 設計 SSOT: docs/design/data-model-resource-scope.md §4.7
export const childChallenges = sqliteTable(
	'child_challenges',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		challengeType: text('challenge_type').notNull().default('cooperative'), // cooperative (新規作成は固定、#2296)
		periodType: text('period_type').notNull().default('weekly'), // weekly | monthly | custom
		startDate: text('start_date').notNull(), // YYYY-MM-DD
		endDate: text('end_date').notNull(), // YYYY-MM-DD
		targetConfig: text('target_config').notNull(), // JSON: { metric, categoryId?, baseTarget }
		rewardConfig: text('reward_config').notNull(), // JSON: { points, message? }
		status: text('status').notNull().default('active'), // active | completed | expired
		isActive: integer('is_active').notNull().default(1),
		// 兄弟連動: 同じ preset / source から複製された instance を group するキー。
		// 同じ sourceTemplateId を持つ instance 同士が SiblingChallengeComparison で比較表示される。
		sourceTemplateId: text('source_template_id'),
		// 進捗 (旧 sibling_challenge_progress と等価、per-child instance 内に inline 化)
		currentValue: integer('current_value').notNull().default(0),
		targetValue: integer('target_value').notNull(),
		completed: integer('completed').notNull().default(0),
		completedAt: text('completed_at'),
		rewardClaimed: integer('reward_claimed').notNull().default(0),
		rewardClaimedAt: text('reward_claimed_at'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_child_challenges_child').on(table.childId, table.status),
		index('idx_child_challenges_dates').on(table.startDate, table.endDate),
		index('idx_child_challenges_source').on(table.sourceTemplateId),
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
// #1593 (ADR-0023 I6) — subscriber_role: 'parent' | 'owner' のみ許容（child は subscribe 拒否）。
// COPPA 改正 (2025/01 最終化、2026/04 対応期限) + ADR-0012 Anti-engagement の二重リスク対策として、
// 子端末への push 通知は構造的に禁止する。送信側でも二重防御で skip。
// 既存レコード backfill 用のため default は 'parent' (ADR-0031 NULL 混在防止)。
export const pushSubscriptions = sqliteTable(
	'push_subscriptions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		endpoint: text('endpoint').notNull().unique(),
		keysP256dh: text('keys_p256dh').notNull(),
		keysAuth: text('keys_auth').notNull(),
		userAgent: text('user_agent'),
		subscriberRole: text('subscriber_role').notNull().default('parent'),
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

// #1816 (2026-05-01): custom_achievements テーブル定義削除
// #1782 (2026-04-30) で実績機能の service / 呼び出し元を全廃済み。
// 物理 schema 定義も dead code として削除（Pre-PMF 利用者ゼロ前提で破壊的変更を許容、ADR-0010 整合）。
// 並行実装ペア: tests/unit/helpers/test-db.ts / tests/e2e/global-setup.ts /
// src/lib/server/db/create-tables.ts も同期削除済み。

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

// #2295 (EPIC #2294 ①): tenant_events / tenant_event_progress テーブル削除済 (2026-05-19)
// season_events 撤去に伴うテナント別 opt-in / 進捗テーブルも完全撤去。
// 並行実装ペアの sqlite / demo / dynamodb repo / service / UI / test fixtures も同期削除。

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
		// #769: コンバージョン分析用カラム（既存レコードは NULL）
		stripeSubscriptionId: text('stripe_subscription_id'), // トライアル後に本契約に移行した場合の Stripe subscription ID
		upgradeReason: text('upgrade_reason'), // 'auto' | 'manual' | 'email_cta' | null
		trialStartSource: text('trial_start_source'), // トライアル開始のトリガー URL: '/pricing' | '/admin/license' | 'signup_param' | null
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
	(table) => [index('idx_viewer_tokens_tenant').on(table.tenantId)],
);

// ============================================================
// daily_battles - 日次バトル記録 (#605)
// ============================================================
export const dailyBattles = sqliteTable(
	'daily_battles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		enemyId: integer('enemy_id').notNull(),
		date: text('date').notNull(), // YYYY-MM-DD
		status: text('status').notNull().default('pending'), // pending | completed
		outcome: text('outcome'), // win | lose | null
		rewardPoints: integer('reward_points').notNull().default(0),
		turnsUsed: integer('turns_used').notNull().default(0),
		playerStatsJson: text('player_stats_json').notNull().default('{}'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('idx_daily_battles_child_date').on(table.childId, table.date),
		index('idx_daily_battles_child').on(table.childId),
	],
);

// ============================================================
// enemy_collection - 敵図鑑 (#605)
// ============================================================
export const enemyCollection = sqliteTable(
	'enemy_collection',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		enemyId: integer('enemy_id').notNull(),
		firstDefeatedAt: text('first_defeated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		defeatCount: integer('defeat_count').notNull().default(1),
	},
	(table) => [
		uniqueIndex('idx_enemy_collection_child_enemy').on(table.childId, table.enemyId),
		index('idx_enemy_collection_child').on(table.childId),
	],
);

// ============================================================
// usage_logs - 子供使用時間ログ (#1292)
// ============================================================
export const usageLogs = sqliteTable(
	'usage_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		childId: integer('child_id')
			.notNull()
			.references(() => children.id),
		startedAt: text('started_at').notNull(), // ISO8601 UTC
		endedAt: text('ended_at'), // NULL = 進行中
		durationSec: integer('duration_sec'), // ended_at設定時に計算
	},
	(table) => [
		index('idx_usage_logs_child_date').on(table.childId, table.startedAt),
		index('idx_usage_logs_tenant').on(table.tenantId, table.startedAt),
	],
);

// ============================================================
// cancellation_reasons - 解約理由ヒアリング (#1596 / ADR-0023 §3.8 / I3)
// 解約フローに必須化された 3 分類 + 自由記述。
// PO の解約原因可視化 / 卒業 vs 離反比率 / 改善方向の検証用。
// 全プラン強制（任意だと偏ったデータしか取れない）。
// ============================================================
export const cancellationReasons = sqliteTable(
	'cancellation_reasons',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		// '卒業' (graduation) | '離反' (churn) | '中断' (pause)
		category: text('category').notNull(),
		freeText: text('free_text'), // 任意、最大 1000 文字
		// 解約時のプラン (free / monthly / yearly / family-monthly / family-yearly / lifetime)
		planAtCancellation: text('plan_at_cancellation'),
		// Stripe subscription ID(あれば。free プランは null)
		stripeSubscriptionId: text('stripe_subscription_id'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_cancellation_reasons_tenant').on(table.tenantId),
		index('idx_cancellation_reasons_category_date').on(table.category, table.createdAt),
		index('idx_cancellation_reasons_date').on(table.createdAt),
	],
);

// ============================================================
// graduation_consent - 卒業フロー (ADR-0023 §3.8 / §5 I10 / #1603)
// 「卒業」選択時の事例公開承諾 + 利用期間記録。
// PO の「ポジティブな解約」KPI 可視化 + PR 用事例蓄積に使う。
// 公開時は実名禁止（親が任意指定する nickname のみ）。
// ============================================================
export const graduationConsent = sqliteTable(
	'graduation_consent',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenantId: text('tenant_id').notNull(),
		// 公開時の表示ニックネーム（実名禁止 — 親が任意指定）
		nickname: text('nickname').notNull(),
		// 公開承諾フラグ（true=事例として公開可、false=ポジティブ KPI のみ集計）
		consented: integer('consented', { mode: 'boolean' }).notNull().default(false),
		// 卒業時の残ポイント合計（参考値）
		userPoints: integer('user_points').notNull().default(0),
		// テナント作成日 → 卒業日 までの日数（平均利用期間 KPI 用）
		usagePeriodDays: integer('usage_period_days').notNull().default(0),
		// 卒業者の任意メッセージ（公開可能な「卒業の言葉」、最大 500 文字）
		message: text('message'),
		consentedAt: text('consented_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_graduation_consent_tenant').on(table.tenantId),
		index('idx_graduation_consent_consented_date').on(table.consented, table.consentedAt),
		index('idx_graduation_consent_date').on(table.consentedAt),
	],
);

// ============================================================
// stripe_webhook_events - Stripe Webhook 冪等性 dedup (Phase 5 子 3 #2641 / Phase 7 PR-1)
// ============================================================
// 同一 event.id 重複処理時の二重課金 / 二重ライセンス発行を防ぐ dedup ログ。
// Stripe at-least-once delivery + CLI `stripe events resend` で同一 event.id 再送が正規動作。
// 30 日 retention (Stripe Events API 保持期間 = 30 日と同期、ADR-0049 整合)。
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.1 (4 backend schema)
// - docs/design/billing-redesign/phase6-db-migration-plan.md §3.1 (本 PR 投入対象)
//
// 関連:
// - dedup 判定 (`findByEventId` SK 単点 lookup) は Phase 7 PR-4a で `stripe-service.ts` の
//   `handleWebhookEvent` dispatcher 入口 (L221) に統合
// - retention cron は Phase 7 PR-5 で実装 (本 PR では schema 配備のみ)
// - DynamoDB 側は schemaless で `storage-stack.ts:29 timeToLiveAttribute='ttl'` 既設定のため CDK 変更なし
export const stripeWebhookEvents = sqliteTable(
	'stripe_webhook_events',
	{
		// Stripe event.id (`evt_*`)、immutable、Stripe 側 SSOT
		eventId: text('event_id').primaryKey(),
		// event.type (`checkout.session.completed` / `invoice.paid` / `subscription_schedule.aborted` 等)
		eventType: text('event_type').notNull(),
		// handler 実行完了時刻 (ISO 8601)、retention cutoff の基準
		processedAt: text('processed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		// 'success' | 'error' | 'skipped' (未購読 event 型) — Phase 7 PR-4a の dispatcher で書込み
		handlerResult: text('handler_result', { enum: ['success', 'error', 'skipped'] }).notNull(),
		// handler 例外時の error message (Stripe.Error.message 最大 500 文字 truncate、PII strip Phase 7 PR-4a)
		errorMessage: text('error_message'),
		// 同一 event.id の再到達回数 (初回 = 0、replay/resend で increment)
		retryCount: integer('retry_count').notNull().default(0),
		// 関連 tenant_id (handler が解決できた場合のみ、analytics 用、PII ではない)
		tenantId: text('tenant_id'),
	},
	(table) => [
		// 30 日 retention cron 用 (processed_at で範囲 delete)
		index('idx_stripe_webhook_events_processed_at').on(table.processedAt),
		// analytics 用 (handler_result='error' の件数集計、event_type 別件数)
		index('idx_stripe_webhook_events_type_result').on(table.eventType, table.handlerResult),
	],
);

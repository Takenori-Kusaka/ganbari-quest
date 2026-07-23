// src/lib/server/db/dsql/schema.ts
// EPIC #3424 / 実装 #3512 (#N0-1) / 設計 SSOT: docs/design/dsql-data-model.md §11.1 / §11.2 / §5
//
// DSQL (Aurora DSQL, PostgreSQL 互換) backend の drizzle pg-core schema。
// sqlite-core (db/schema.ts) と「同一論理モデル・物理は backend 別」(§4.1)。
// PK は §11.2 凍結表 = pk-freeze-manifest.ts と一致必須 (fitness#9 / §P1 不可逆)。
//
// ── 段階的 population (Canon TDD triangulate) ──
//   本コミット: children (linchpin) のみ。以後 Phase B/C の各 issue で該当表を追記。

import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { ARCHIVED_REASONS } from '$lib/domain/archive-types';
import { BATTLE_OUTCOMES, DAILY_BATTLE_STATUSES } from '$lib/domain/battle-types';
import { CHECKLIST_OVERRIDE_ACTIONS } from '$lib/domain/constants/checklist-override-action';
import { type TimeSlot, VALID_TIME_SLOTS } from '$lib/domain/constants/checklist-time-slot';
import {
	CHALLENGE_PERIOD_TYPES,
	CHILD_CHALLENGE_STATUSES,
} from '$lib/domain/constants/child-challenge';
import {
	CLOUD_EXPORT_STATUSES,
	type CloudExportStatus,
} from '$lib/domain/constants/cloud-export-status';
import { INQUIRY_STATUSES } from '$lib/domain/constants/inquiry';
import { REDEMPTION_STATUSES } from '$lib/domain/constants/redemption-status';
import { STAMP_CARD_STATUSES, type StampCardStatus } from '$lib/domain/constants/stamp-card-status';
import {
	ALL_SUBSCRIPTION_STATUSES,
	type SubscriptionStatus,
} from '$lib/domain/constants/subscription-status';
import { UI_MODES } from '$lib/domain/validation/age-tier-types';
import { MESSAGE_TYPES } from '$lib/domain/validation/message';
import {
	AUTH_PROVIDERS,
	type AuthProviderKind,
	CONSENT_TYPES,
	type ConsentType,
	INVITE_STATUSES,
	type InviteStatus,
} from '$lib/server/auth/entities';
import { ROLES, type Role } from '$lib/server/auth/types';
import { ACTIVITY_PRIORITY_KEYS, enumCheck, THEME_KEYS } from './check-constraints';

// children — Child 集約の linchpin (§11.1)。
// 変更点 (vs sqlite 現行):
//   - PK: 整数 autoincrement id → 複合 (family_id, child_id uuid v4)。§P2 複合 tenant PK + §P3 UUID。
//   - age 列を撤去 → birth_date から compute-on-read で ui_mode 派生 (§11.1 age→ui_mode 読取時導出)。
//   - _sv (楽観ロック version) を撤去 → DSQL は OCC (§8) ゆえ不要。
//   - temporal 列は { mode: 'string' } 固定 (fitness#6、pg=Date/sqlite=string の型 drift 防止)。
//   - theme / ui_mode / archived_reason の CHECK 制約 (SSOT 生成) は次サイクル (fitness#13 dialect-parity)。
export const children = pgTable(
	'children',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull().default(sql`gen_random_uuid()`),
		nickname: text('nickname').notNull(),
		// age 列は持たない (§11.1 compute-on-read)。birth_date が唯一の年齢ソース。
		birthDate: text('birth_date'),
		theme: text('theme').notNull().default('pink'),
		uiMode: text('ui_mode').notNull().default('preschool'),
		uiModeManuallySet: boolean('ui_mode_manually_set').notNull().default(false),
		avatarUrl: text('avatar_url'),
		displayConfig: text('display_config'),
		userId: text('user_id'),
		birthdayBonusMultiplier: real('birthday_bonus_multiplier').notNull().default(1.0),
		lastBirthdayBonusYear: integer('last_birthday_bonus_year'),
		// 残高派生列 (§5 P7、#3539): 全 point_ledger 書込 mini-txn 内で共更新 (SUM 乖離不能)。
		// H2 の毎描画 SUM スキャンを列 read 1 回に置換。突合 = fitness#14 (derived-drift.ts)。
		totalPoint: integer('total_point').notNull().default(0),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		isArchived: boolean('is_archived').notNull().default(false),
		archivedReason: text('archived_reason', { enum: ARCHIVED_REASONS }),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId] }),
		// CHECK は SSOT から生成 (fitness#13、手書き二重化禁止)。pg/sqlite が同一 helper 共有で一致。
		check('children_ui_mode_ck', enumCheck(t.uiMode, UI_MODES)),
		check('children_theme_ck', enumCheck(t.theme, THEME_KEYS)),
		check('children_archived_reason_ck', enumCheck(t.archivedReason, ARCHIVED_REASONS)),
	],
);

// ── auth ドメイン 5 表 (§6.6、#3528 Phase B cycle (a): users/families/memberships) ──
// invites/consents は cycle (b) で追記 (受諾 txn は Phase A の runInTransaction 依存)。
// ⚠️ owner_guard UNIQUE は「owner ≤ 1」のみを守る。「誰が role を書けるか」は
//    requireRole(['owner']) route guard (fitness#3) が担う — repo/route 実装 PR で必須。

// users — グローバル表 (tenant 非依存、§11.2 例外)。email lookup item (Dynamo GSI) を
// email_lower 生成列 + UNIQUE に置換 (findUserByEmail HOT、case-insensitive 重複防止、spike#6 F7)。
export const users = pgTable(
	'users',
	{
		userId: uuid('user_id').notNull().default(sql`gen_random_uuid()`),
		email: text('email').notNull(),
		emailLower: text('email_lower')
			.generatedAlwaysAs((): ReturnType<typeof sql> => sql`lower(email)`)
			.unique(),
		provider: text('provider').notNull().$type<AuthProviderKind>(),
		displayName: text('display_name'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.userId] }),
		check('users_provider_ck', enumCheck(t.provider, AUTH_PROVIDERS)),
	],
);

// families — テナントルート + subscription 属性 (独立 subscription 表は作らない、§6.6)。
// plan は plans lookup 表参照のため CHECK を張らない (増減集合、営業パネル 2026-07-01。
// CHECK 固定だと DSQL の ALTER 後付け不可 §10-5 で新プラン投入が表再構築になる)。
// status は Stripe 固定 enum ゆえ CHECK 据置。licenseStatus は算出 (列なし)。
export const families = pgTable(
	'families',
	{
		familyId: uuid('family_id').notNull().default(sql`gen_random_uuid()`),
		name: text('name').notNull(),
		// denormalized cache (SSOT = memberships.owner_guard)。updateTenantOwner が同一 txn で更新。
		ownerUserId: uuid('owner_user_id'),
		status: text('status').notNull().$type<SubscriptionStatus>(),
		plan: text('plan'),
		// UNIQUE は複数 NULL を許容 (未課金テナント多数、spike#6 F8 実機確証)。stripe 2hop→1hop。
		stripeCustomerId: text('stripe_customer_id').unique(),
		stripeSubscriptionId: text('stripe_subscription_id'),
		planExpiresAt: timestamp('plan_expires_at', { mode: 'string', withTimezone: true }),
		trialUsedAt: timestamp('trial_used_at', { mode: 'string', withTimezone: true }),
		// 休眠判定 (90 日、#1601)。listAllTenants は created_at cursor ページング (§6.6)。
		lastActiveAt: timestamp('last_active_at', { mode: 'string', withTimezone: true }),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId] }),
		check('families_status_ck', enumCheck(t.status, ALL_SUBSCRIPTION_STATUSES)),
	],
);

// memberships — user × family の関係 (role の 1 行 SSOT、Dynamo の 2 item 二重書きを廃止)。
// owner_guard: role='owner' の行だけ family_id が入る STORED 生成列。UNIQUE により
// 同一 family の 2 人目 owner INSERT/UPDATE は 23505 で物理拒否 (owner ≤ 1、spike#3/#6 F6)。
export const memberships = pgTable(
	'memberships',
	{
		familyId: uuid('family_id').notNull(),
		userId: uuid('user_id').notNull(),
		role: text('role').notNull().$type<Role>(),
		ownerGuard: uuid('owner_guard')
			.generatedAlwaysAs(
				(): ReturnType<typeof sql> => sql`CASE WHEN role = 'owner' THEN family_id END`,
			)
			.unique(),
		invitedBy: uuid('invited_by'),
		joinedAt: timestamp('joined_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.userId] }),
		// findUserTenants (session 3 連 lookup の起点) 用 secondary (§6.6)。
		index('memberships_user_id_idx').on(t.userId),
		check('memberships_role_ck', enumCheck(t.role, ROLES)),
	],
);

// invites — 招待リンク (adjacency item 廃止、§6.6)。
// token_hash: 招待コードの timing-safe ハッシュのみ保存 (raw 非保存 = CWE-522、bearer 化による
// 機密性退行を防ぐ)。email: 設定時は受諾 user の email と一致必須 (§6.6 ⚠️ 横流し防止、
// invite-accept.ts が txn 内で検証)。child_id は children UUID (#3512 greenfield) 参照。
export const invites = pgTable(
	'invites',
	{
		inviteId: uuid('invite_id').notNull().default(sql`gen_random_uuid()`),
		familyId: uuid('family_id').notNull(),
		invitedBy: uuid('invited_by').notNull(),
		role: text('role').notNull().$type<Role>(),
		childId: uuid('child_id'),
		email: text('email'),
		tokenHash: text('token_hash').notNull().unique(),
		status: text('status').notNull().default('pending').$type<InviteStatus>(),
		expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
		acceptedBy: uuid('accepted_by'),
		acceptedAt: timestamp('accepted_at', { mode: 'string', withTimezone: true }),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.inviteId] }),
		// findTenantInvites 用 secondary (§6.6)。
		index('invites_family_id_idx').on(t.familyId),
		check('invites_status_ck', enumCheck(t.status, INVITE_STATUSES)),
		check('invites_role_ck', enumCheck(t.role, ROLES)),
	],
);

// consents — 利用規約/PP 同意記録 (append-only、§6.6 / GDPR Art.7 / COPPA)。
// UPDATE/DELETE は repo 非定義 + GRANT 除外 + fitness#2 多層禁止 (repo 実装 PR で強制)。
// 最新判定は consented_at 降順 (version 文字列順に依存しない)。
export const consents = pgTable(
	'consents',
	{
		consentId: uuid('consent_id').notNull().default(sql`gen_random_uuid()`),
		familyId: uuid('family_id').notNull(),
		userId: uuid('user_id').notNull(),
		type: text('type').notNull().$type<ConsentType>(),
		version: text('version').notNull(),
		consentedAt: timestamp('consented_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		ipAddress: text('ip_address').notNull(),
		userAgent: text('user_agent').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.consentId] }),
		// findLatestConsent (HTML GET 毎 2 read、§3.5.3) 用 secondary (§6.6)。
		index('consents_family_type_at_idx').on(t.familyId, t.type, t.consentedAt),
		check('consents_type_ck', enumCheck(t.type, CONSENT_TYPES)),
	],
);

// ── Child 集約 core hot-path 5 表 (§3.5.1、#3539 #N4-1 Phase C) ──
// recordActivity 単一 txn (#N4-2) の書込対象。§4.1: PK covering 最優先、
// secondary は spike#7 で採用確定した point_ledger の 1 本のみ (他は計測後に追加判断)。
// category_id はグローバル master categories(code) 自然キーへの論理 FK (DSQL FK 非対応、text)。

// child_activities — 活動の per-child instance (§6 PO 判断: catalog+override 不採用、
// 兄弟共通化は copy)。旧 activities master の二重実装は新スキーマに作らない。
export const childActivities = pgTable(
	'child_activities',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		activityId: uuid('activity_id').notNull().default(sql`gen_random_uuid()`),
		name: text('name').notNull(),
		categoryId: text('category_id').notNull(),
		icon: text('icon').notNull(),
		basePoints: integer('base_points').notNull().default(5),
		isVisible: boolean('is_visible').notNull().default(true),
		dailyLimit: integer('daily_limit'),
		sortOrder: integer('sort_order').notNull().default(0),
		source: text('source').notNull().default('seed'),
		nameKana: text('name_kana'),
		nameKanji: text('name_kanji'),
		triggerHint: text('trigger_hint'),
		isMainQuest: boolean('is_main_quest').notNull().default(false),
		isArchived: boolean('is_archived').notNull().default(false),
		archivedReason: text('archived_reason', { enum: ARCHIVED_REASONS }),
		sourcePresetId: text('source_preset_id'),
		priority: text('priority').notNull().default('optional'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.activityId] }),
		check('child_activities_priority_ck', enumCheck(t.priority, ACTIVITY_PRIORITY_KEYS)),
		check('child_activities_archived_reason_ck', enumCheck(t.archivedReason, ARCHIVED_REASONS)),
	],
);

// activity_logs — 活動記録。streak_days/streak_bonus は記録 txn 内で算出・確定する派生列 (§5)。
// date secondary は初期不使用 (PK プレフィクス scan ~1.5ms、spike#7。計測後に追加判断)。
export const activityLogs = pgTable(
	'activity_logs',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		logId: uuid('log_id').notNull().default(sql`gen_random_uuid()`),
		activityId: uuid('activity_id').notNull(),
		points: integer('points').notNull(),
		streakDays: integer('streak_days').notNull().default(1),
		streakBonus: integer('streak_bonus').notNull().default(0),
		recordedDate: text('recorded_date').notNull(),
		recordedAt: timestamp('recorded_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		cancelled: boolean('cancelled').notNull().default(false),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.logId] })],
);

// point_ledger — ポイント台帳 (append 主体)。UUID v4 random で hot-partition ゼロ (§11.2)。
// created_at は sort 用途のみで PK に入れない (判断⑬訂正)。全 INSERT は同一 mini-txn で
// children.total_point を共更新する (§5 P7、fitness#14 が突合)。
export const pointLedger = pgTable(
	'point_ledger',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		ledgerId: uuid('ledger_id').notNull().default(sql`gen_random_uuid()`),
		amount: integer('amount').notNull(),
		type: text('type').notNull(),
		description: text('description'),
		// polymorphic 参照 (旧 int id / 新 uuid 混在を許容するため text)。
		referenceId: text('reference_id'),
		// 冪等 lookup (countPointLedgerEntriesByTypeAndDate H21) 用 'YYYY-MM-DD'。
		recordedDate: text('recorded_date').notNull(),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.ledgerId] }),
		// spike#7 採用の唯一の初期 secondary (§11.2)。履歴ページング用 (family,child,created_at)
		// は計測後の任意追加。
		index('point_ledger_type_date_idx').on(t.familyId, t.childId, t.type, t.recordedDate),
		// #3284: 付与の冪等キー。reference_id NULL 行は pg の UNIQUE NULL-distinct 規則で
		// 複数許容されるため partial index 不要 (DSQL は partial unique 非対応、spike 実機確証)。
		// referenceId 付き付与 (activity / cancel / child_challenge / reward_redemption /
		// special_reward) の二重 insert を DB レベルで物理拒否する。migration では
		// CREATE UNIQUE INDEX → runner が ASYNC 変換 + build poll (transform.ts 責務 2)。
		uniqueIndex('point_ledger_idempotency_uq').on(t.familyId, t.childId, t.type, t.referenceId),
	],
);

// statuses — カテゴリ別現在ステータス (自然複合 PK、unique(child,category) 昇格 §11.2)。
// total_xp/level/peak_xp は status 更新 txn 内で維持する派生列 (§5)。_sv 撤去 (OCC)。
export const statuses = pgTable(
	'statuses',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		categoryId: text('category_id').notNull(),
		totalXp: integer('total_xp').notNull().default(0),
		level: integer('level').notNull().default(1),
		peakXp: integer('peak_xp').notNull().default(0),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.categoryId] })],
);

// status_history — ステータス変動履歴。recorded_at は sort 用途 (PK に入れない、§11.2)。
// findRecentStatusHistory は category プレフィクス scan + sort LIMIT2 (§3.5.1 H5)。
export const statusHistory = pgTable(
	'status_history',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		categoryId: text('category_id').notNull(),
		histId: uuid('hist_id').notNull().default(sql`gen_random_uuid()`),
		value: real('value').notNull(),
		changeAmount: real('change_amount').notNull(),
		changeType: text('change_type').notNull(),
		recordedAt: timestamp('recorded_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.categoryId, t.histId] })],
);

// activity_mastery — 活動習熟度 (自然複合 PK、unique(child,activity) 昇格 §11.2、#3541)。
// total_count/level は記録 txn 内で re-read + upsert する派生 (record-activity-core.ts §8)。
export const activityMastery = pgTable(
	'activity_mastery',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		activityId: uuid('activity_id').notNull(),
		totalCount: integer('total_count').notNull().default(0),
		level: integer('level').notNull().default(1),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.activityId] })],
);

// daily_missions — デイリーミッション (自然複合 PK、§11.2 凍結: unique(child,mission_date,activity) 昇格)。
// completed=false→true の conditional UPDATE が once-per-day bonus の serialization point
// (fitness#10、daily-mission-complete.ts。count-then-insert の TOCTOU 二重付与を構造排除)。
export const dailyMissions = pgTable(
	'daily_missions',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		missionDate: text('mission_date').notNull(),
		activityId: uuid('activity_id').notNull(),
		completed: boolean('completed').notNull().default(false),
		completedAt: timestamp('completed_at', { mode: 'string', withTimezone: true }),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.missionDate, t.activityId] })],
);

// ── StampCard 集約 (§3、Child サブ集約) + ChecklistTemplate 集約 (family master、ADR-0055) ──

// stamp_cards — 週次スタンプカード。UUID surrogate PK (PO 決裁 2026-07-03、PR #3547:
// シーズン/イベントカード復活があり得る = 同一週複数カードの cardinality 可変で自然複合凍結
// 不可、governing rule §11.2)。「1子1週1枚」の現行制約は droppable UNIQUE(week_start) で維持
// (復活時は UNIQUE を DROP するだけで PK 不変)。card_id は stamp_entries の論理参照先を兼ねる。
// status は 3 値状態機械 (SSOT 生成 CHECK)。
export const stampCards = pgTable(
	'stamp_cards',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		cardId: uuid('card_id').notNull().default(sql`gen_random_uuid()`),
		weekStart: text('week_start').notNull(),
		weekEnd: text('week_end').notNull(),
		status: text('status').notNull().default('collecting').$type<StampCardStatus>(),
		redeemedPoints: integer('redeemed_points'),
		redeemedAt: timestamp('redeemed_at', { mode: 'string', withTimezone: true }),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.cardId] }),
		// 現行「1子1週1枚」制約 (droppable。シーズン/イベントカード導入時に DROP)。
		unique('stamp_cards_week_uq').on(t.familyId, t.childId, t.weekStart),
		check('stamp_cards_status_ck', enumCheck(t.status, STAMP_CARD_STATUSES)),
	],
);

// stamp_entries — カード内押印 (card 単位サブ集約 §3)。stamp_cards は UUID surrogate PK
// (family_id, child_id, card_id uuid) (PO 決裁 2026-07-03)。card_id は stamp_cards PK の
// 第 3 要素 card_id を指す論理 FK (DSQL FK 非対応のため制約なし、cross-family / orphan 防止は
// アプリ層 repo の責務)。PK は §11.2 の凍結 PK (family_id, card_id, slot)。
// UNIQUE (family_id, card_id, login_date) = 1日1押印 (consistency minor、§11.2 補助 UNIQUE)。
export const stampEntries = pgTable(
	'stamp_entries',
	{
		familyId: uuid('family_id').notNull(),
		cardId: uuid('card_id').notNull(),
		slot: integer('slot').notNull(),
		stampMasterId: text('stamp_master_id'),
		omikujiRank: text('omikuji_rank'),
		loginDate: text('login_date').notNull(),
		earnedAt: timestamp('earned_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.cardId, t.slot] }),
		unique('stamp_entries_daily_uq').on(t.familyId, t.cardId, t.loginDate),
	],
);

// checklist_templates — family master (ADR-0055: template は tenant 1 レコード、
// per-child は assignments で配信)。time_slot CHECK は VALID_TIME_SLOTS SSOT 生成。
export const checklistTemplates = pgTable(
	'checklist_templates',
	{
		familyId: uuid('family_id').notNull(),
		templateId: uuid('template_id').notNull().default(sql`gen_random_uuid()`),
		name: text('name').notNull(),
		icon: text('icon').notNull().default('📋'),
		pointsPerItem: integer('points_per_item').notNull().default(2),
		completionBonus: integer('completion_bonus').notNull().default(5),
		timeSlot: text('time_slot').notNull().default('anytime').$type<TimeSlot>(),
		isActive: boolean('is_active').notNull().default(true),
		isArchived: boolean('is_archived').notNull().default(false),
		archivedReason: text('archived_reason', { enum: ARCHIVED_REASONS }),
		// #1254 G1: marketplace 取込元 preset の provenance (弱帰属、FK 無し)。SQLite SSOT
		// (schema.ts:472) と同 shape。dedup (checklist-template-import-service / checklist-strategy の
		// existingTemplates.find(t => t.sourcePresetId === presetId)) の miss = 二重取込を防ぐため
		// 兄弟 type (child_activities/special_rewards の source_preset_id) と同様 DSQL にも配備する。
		sourcePresetId: text('source_preset_id'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.templateId] }),
		check('checklist_templates_time_slot_ck', enumCheck(t.timeSlot, VALID_TIME_SLOTS)),
		check('checklist_templates_archived_reason_ck', enumCheck(t.archivedReason, ARCHIVED_REASONS)),
	],
);

// checklist_template_items — template 内項目。frequency は 'daily' / 'weekday:N' の
// パターン集合 (固定 enum でない) ため CHECK を張らない (fitness#13 は固定集合のみ対象)。
export const checklistTemplateItems = pgTable(
	'checklist_template_items',
	{
		familyId: uuid('family_id').notNull(),
		templateId: uuid('template_id').notNull(),
		itemId: uuid('item_id').notNull().default(sql`gen_random_uuid()`),
		name: text('name').notNull(),
		icon: text('icon').notNull().default('🏫'),
		frequency: text('frequency').notNull().default('daily'),
		direction: text('direction').notNull().default('bring'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.templateId, t.itemId] })],
);

// checklist_template_assignments — template × child の配信 (N:M、自然複合 PK 昇格 §11.2)。
// secondary (family_id, child_id) = findTemplatesByChild hot path (§11.2 補助 secondary)。
export const checklistTemplateAssignments = pgTable(
	'checklist_template_assignments',
	{
		familyId: uuid('family_id').notNull(),
		templateId: uuid('template_id').notNull(),
		childId: uuid('child_id').notNull(),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.templateId, t.childId] }),
		index('checklist_template_assignments_child_idx').on(t.familyId, t.childId),
	],
);

// ── Child 集約 残り表 Slice A: 記録系 9 表 (§11.2 / §5、#3424) ──
// PK は pk-freeze-manifest (= §11.2 凍結) と fitness#9 [3] が自動突合。

// evaluations — 週次評価。scoresJson は text 据置 (M3 §4.2 [must]A / reset-plan 決定#1:
// 子表 evaluation_scores を作らない。field query 0 件で列展開の実利益ゼロ + backup verbatim +
// SQLite parity。子表化は原初のデータ喪失の現場ゆえ text 据置に是正)。カテゴリ別スコア集合を
// scores_json (JSON 文字列) に丸ごと保持する。
// created_at は sort 用途 (findEvaluationsByChild = PK プレフィクス + sort LIMIT、§11.2)。
export const evaluations = pgTable(
	'evaluations',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		evalId: uuid('eval_id').notNull().default(sql`gen_random_uuid()`),
		weekStart: text('week_start').notNull(),
		weekEnd: text('week_end').notNull(),
		// カテゴリ別スコアの JSON 文字列を据置 (子表化しない、M3 §4.2)。SQLite SSOT と同 shape。
		scoresJson: text('scores_json').notNull(),
		bonusPoints: integer('bonus_points').notNull().default(0),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.evalId] }),
		// #3782: eval_id は random UUID surrogate のため PK だけでは (child, weekStart) 重複を許容する。
		// 「1子1週1評価」を droppable UNIQUE で維持 (stamp_cards_week_uq と同型。将来 seasonal 多重評価が
		// 必要になれば index を DROP するだけで PK 不変)。service 層 dedup (#3355) の canonical backstop
		// (ADR-0061 push-down-pyramid)。async index build は transform.ts が CREATE UNIQUE INDEX ASYNC へ変換。
		uniqueIndex('evaluations_week_uq').on(t.familyId, t.childId, t.weekStart),
	],
);

// rest_days — おやすみ日 (自然複合 PK 昇格、anchor (a) ADR-0012: 1日1回 = policy invariant §11.2)。
export const restDays = pgTable(
	'rest_days',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		date: text('date').notNull(),
		reason: text('reason').notNull().default('rest'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.date] })],
);

// daily_battles — 日次バトル (自然複合 PK 昇格、anchor (a) ADR-0012 §11.2)。
// playerStatsJson は text 据置 (M3 §10 / 値オブジェクト Q-06=A: 列展開すると BattleStats の
// キー変動時に silent drop を招く。JSON 文字列で丸ごと保持し SQLite SSOT と parity)。
// enemy_id はコード内 enemy master の安定 id (DB 採番 surrogate でないため integer 維持)。
export const dailyBattles = pgTable(
	'daily_battles',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		date: text('date').notNull(),
		enemyId: integer('enemy_id').notNull(),
		status: text('status').notNull().default('pending'),
		outcome: text('outcome'),
		rewardPoints: integer('reward_points').notNull().default(0),
		turnsUsed: integer('turns_used').notNull().default(0),
		// BattleStats (hp/atk/def/spd/rec 等) の JSON 文字列を据置 (列展開しない、M3 §10)。
		playerStatsJson: text('player_stats_json').notNull().default('{}'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.date] }),
		check('daily_battles_status_ck', enumCheck(t.status, DAILY_BATTLE_STATUSES)),
		check('daily_battles_outcome_ck', enumCheck(t.outcome, BATTLE_OUTCOMES)),
	],
);

// enemy_collection — 敵図鑑 (自然複合 PK 昇格 §11.2)。enemy_id はコード内 master の安定 id。
export const enemyCollection = pgTable(
	'enemy_collection',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		enemyId: integer('enemy_id').notNull(),
		firstDefeatedAt: timestamp('first_defeated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		defeatCount: integer('defeat_count').notNull().default(1),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.enemyId] })],
);

// checklist_logs — 日次チェック記録 (自然複合 PK 昇格 §11.2)。itemsJson は text 据置
// (M3 §4.2 [must]A / reset-plan 決定#1: 子表 checklist_log_items を作らない。field query 0 件 +
// item_id gap #3601 同時解消。checked item id 集合を JSON 文字列で丸ごと保持し SQLite SSOT と parity)。
export const checklistLogs = pgTable(
	'checklist_logs',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		templateId: uuid('template_id').notNull(),
		checkedDate: text('checked_date').notNull(),
		// checked item id 配列の JSON 文字列を据置 (子表化しない、M3 §4.2)。SQLite SSOT と同 shape。
		itemsJson: text('items_json').notNull().default('[]'),
		completedAll: boolean('completed_all').notNull().default(false),
		pointsAwarded: integer('points_awarded').notNull().default(0),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.templateId, t.checkedDate] })],
);

// checklist_overrides — 日次 override (UUID surrogate §11.2: 自然キー一意の前提を置かず確定 N5)。
export const checklistOverrides = pgTable(
	'checklist_overrides',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		overrideId: uuid('override_id').notNull().default(sql`gen_random_uuid()`),
		targetDate: text('target_date').notNull(),
		action: text('action').notNull(),
		itemName: text('item_name').notNull(),
		icon: text('icon').notNull().default('📦'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.overrideId] }),
		check('checklist_overrides_action_ck', enumCheck(t.action, CHECKLIST_OVERRIDE_ACTIONS)),
	],
);

// child_activity_preferences — ピン留め設定 (自然複合 PK 昇格、§3 欠落→編入 §11.2)。
export const childActivityPreferences = pgTable(
	'child_activity_preferences',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		activityId: uuid('activity_id').notNull(),
		isPinned: boolean('is_pinned').notNull().default(false),
		pinOrder: integer('pin_order'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.activityId] })],
);

// ── Child 集約 残り表 Slice B: ボーナス・報酬・メッセージ系 10 表 (§11.2 / §5、#3424) ──

// login_streaks — ログインボーナス counter (#3330 案 B counter 縮約)。
// per-date 行 (旧 login_bonuses) は廃止し、子供ごとに 1 行 (child-level 自然 PK) のみ保持する。
// 当日冪等 (1日1回 = ADR-0012) は claimToday の conditional write (単一 INSERT ... ON CONFLICT
// DO UPDATE ... WHERE last_login_date <> excluded.last_login_date) が原子的に担保する。
export const loginStreaks = pgTable(
	'login_streaks',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		lastLoginDate: text('last_login_date').notNull(),
		currentStreak: integer('current_streak').notNull().default(1),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId] })],
);

// certificates — がんばり証明書 (UUID surrogate、§11.2 governing rule: 再発行/周期型証書が
// roadmap プラウジブル)。metadata は発行後 immutable・不検索で §5 上 jsonb 可だが、backup の
// verbatim 移送 (§9.1) を優先し text 維持 ({mode:'json'} 化は repo PR で判断)。
// certificate_type は増減集合 (周期型証書の追加があり得る) のため CHECK 対象外。
// 「1 type 有効1通」の active_key 生成列 + UNIQUE (§11.2「要時、droppable」) は、現 product に
// 有効/無効 (revoke) 概念が無く「要時」に該当しないため未設置 (導入時に ALTER で追加可)。
export const certificates = pgTable(
	'certificates',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		certificateId: uuid('certificate_id').notNull().default(sql`gen_random_uuid()`),
		certificateType: text('certificate_type').notNull(),
		title: text('title').notNull(),
		description: text('description'),
		issuedAt: timestamp('issued_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
		metadata: text('metadata'),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.certificateId] })],
);

// special_rewards — 特別ごほうび。granted_by は親 user 等の polymorphic 参照 (旧 int/新 uuid
// 混在許容で text、point_ledger.reference_id と同判断)。shop_category は増減集合で CHECK 対象外。
export const specialRewards = pgTable(
	'special_rewards',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		rewardId: uuid('reward_id').notNull().default(sql`gen_random_uuid()`),
		grantedBy: text('granted_by'),
		title: text('title').notNull(),
		description: text('description'),
		points: integer('points').notNull(),
		icon: text('icon'),
		category: text('category').notNull(),
		grantedAt: timestamp('granted_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		shownAt: timestamp('shown_at', { mode: 'string', withTimezone: true }),
		sourcePresetId: text('source_preset_id'),
		shopCategory: text('shop_category'),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.rewardId] }),
		// findUnshownReward hot (§11.2 補助 secondary)。
		index('special_rewards_granted_idx').on(t.familyId, t.childId, t.grantedAt),
	],
);

// reward_redemption_requests — ごほうびショップ交換申請 (#1337)。
// requested_at/resolved_at/shown_to_child_at は旧 epoch integer → timestamptz に正規化 (§11.3)。
// reward_title/points/icon は申請時点 snapshot (#2832、非正規化は実装事実と一致 判断①)。
export const rewardRedemptionRequests = pgTable(
	'reward_redemption_requests',
	{
		familyId: uuid('family_id').notNull(),
		redemptionId: uuid('redemption_id').notNull().default(sql`gen_random_uuid()`),
		childId: uuid('child_id').notNull(),
		rewardId: uuid('reward_id').notNull(),
		requestedAt: timestamp('requested_at', { mode: 'string', withTimezone: true }).notNull(),
		status: text('status').notNull().default('pending_parent_approval'),
		parentNote: text('parent_note'),
		resolvedAt: timestamp('resolved_at', { mode: 'string', withTimezone: true }),
		resolvedByParentId: text('resolved_by_parent_id'),
		shownToChildAt: timestamp('shown_to_child_at', { mode: 'string', withTimezone: true }),
		rewardTitle: text('reward_title'),
		rewardPoints: integer('reward_points'),
		rewardIcon: text('reward_icon'),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.redemptionId] }),
		// §11.2 補助 secondary 2 本 (child×status / status×requested_at)。
		index('redemption_child_status_idx').on(t.familyId, t.childId, t.status),
		index('redemption_status_requested_idx').on(t.familyId, t.status, t.requestedAt),
		check('reward_redemption_requests_status_ck', enumCheck(t.status, REDEMPTION_STATUSES)),
	],
);

// parent_messages — 親→子メッセージ。sent_at は sort 用途 (PK に入れない §11.2、
// findMessages/findUnshownMessage は PK プレフィクス + shown_at 残差 + sort LIMIT)。
export const parentMessages = pgTable(
	'parent_messages',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		msgId: uuid('msg_id').notNull().default(sql`gen_random_uuid()`),
		messageType: text('message_type').notNull(),
		stampCode: text('stamp_code'),
		body: text('body'),
		icon: text('icon').notNull().default('💌'),
		sentAt: timestamp('sent_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
		shownAt: timestamp('shown_at', { mode: 'string', withTimezone: true }),
		bonusPoints: integer('bonus_points'),
		rewardCategory: text('reward_category'),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.msgId] }),
		check('parent_messages_message_type_ck', enumCheck(t.messageType, MESSAGE_TYPES)),
	],
);

// sibling_cheers — 兄弟応援 (family scope、from/to の 2 child 参照のため child 主軸にしない §11.2)。
export const siblingCheers = pgTable(
	'sibling_cheers',
	{
		familyId: uuid('family_id').notNull(),
		cheerId: uuid('cheer_id').notNull().default(sql`gen_random_uuid()`),
		fromChildId: uuid('from_child_id').notNull(),
		toChildId: uuid('to_child_id').notNull(),
		stampCode: text('stamp_code').notNull(),
		sentAt: timestamp('sent_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
		shownAt: timestamp('shown_at', { mode: 'string', withTimezone: true }),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.cheerId] }),
		// findUnshownCheers hot (§11.2 補助 secondary)。
		index('sibling_cheers_to_shown_idx').on(t.familyId, t.toChildId, t.shownAt),
	],
);

// character_images — キャラ画像 (key+メタのみ §9.4、バイトは IStorageRepo)。
export const characterImages = pgTable(
	'character_images',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		imageId: uuid('image_id').notNull().default(sql`gen_random_uuid()`),
		type: text('type').notNull(),
		filePath: text('file_path').notNull(),
		promptHash: text('prompt_hash'),
		generatedAt: timestamp('generated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.imageId] })],
);

// child_custom_voices — ユーザー録音ボイス (source/not-yet-exported = backup 必須 §11.2)。
// key+メタのみ (§9.4)、scene は素の列。
export const childCustomVoices = pgTable(
	'child_custom_voices',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		voiceId: uuid('voice_id').notNull().default(sql`gen_random_uuid()`),
		scene: text('scene').notNull().default('complete'),
		label: text('label').notNull(),
		filePath: text('file_path').notNull(),
		publicUrl: text('public_url').notNull(),
		durationMs: integer('duration_ms'),
		isActive: boolean('is_active').notNull().default(false),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.voiceId] })],
);

// child_challenges — per-child チャレンジ (#2362 PR-7)。targetConfig/rewardConfig は text 据置
// (M3 §4.2 [must]A: 列展開すると実 write の genMode/genMissStreak(#3203 救済入力)/activityId/
// ageAdjustments を silent drop = 原初喪失そのもの。最 severe。JSON 文字列で丸ごと保持し
// SQLite SSOT と parity)。challenge_type は増減集合 (CHECK 対象外)。
export const childChallenges = pgTable(
	'child_challenges',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		challengeId: uuid('challenge_id').notNull().default(sql`gen_random_uuid()`),
		title: text('title').notNull(),
		description: text('description'),
		challengeType: text('challenge_type').notNull().default('cooperative'),
		periodType: text('period_type').notNull().default('weekly'),
		startDate: text('start_date').notNull(),
		endDate: text('end_date').notNull(),
		// { metric, categoryId?, baseTarget, genMode?, genMissStreak?, activityId?, ageAdjustments? }
		// を丸ごと据置 (列展開しない、M3 §4.2)。SQLite SSOT と同 shape。
		targetConfig: text('target_config').notNull(),
		// { points, message? } を丸ごと据置 (列展開しない)。
		rewardConfig: text('reward_config').notNull(),
		status: text('status').notNull().default('active'),
		isActive: boolean('is_active').notNull().default(true),
		sourceTemplateId: text('source_template_id'),
		currentValue: integer('current_value').notNull().default(0),
		targetValue: integer('target_value').notNull(),
		completed: boolean('completed').notNull().default(false),
		completedAt: timestamp('completed_at', { mode: 'string', withTimezone: true }),
		rewardClaimed: boolean('reward_claimed').notNull().default(false),
		rewardClaimedAt: timestamp('reward_claimed_at', { mode: 'string', withTimezone: true }),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		// #3245 atomic get-or-create (auto:weekly): DSQL は部分 unique index 非対応 (spike 実機確証)
		// のため、owner_guard パターン (memberships.owner_guard / users.email_lower と同型) の
		// STORED 生成列 + droppable UNIQUE で「auto:weekly 行のみ (child, start_date) 一意」を
		// 条件付き一意化する。非 auto 行は NULL (UNIQUE は複数 NULL 許容、spike#6 F8)。
		// 'auto:weekly' リテラルは AUTO_WEEKLY_SOURCE_TEMPLATE_ID (types/index.ts SSOT) と同値
		// (生成列式は SQL リテラル必須のため直書き、変更時は両方同時更新)。
		weeklyAutoGuard: text('weekly_auto_guard')
			.generatedAlwaysAs(
				(): ReturnType<typeof sql> =>
					sql`CASE WHEN source_template_id = 'auto:weekly' THEN (child_id::text || ':' || start_date) ELSE NULL END`,
			)
			.unique(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.childId, t.challengeId] }),
		// findActiveOrUnclaimed hot (§11.2 補助 secondary)。
		index('child_challenges_status_idx').on(t.familyId, t.childId, t.status),
		check('child_challenges_status_ck', enumCheck(t.status, CHILD_CHALLENGE_STATUSES)),
		check('child_challenges_period_type_ck', enumCheck(t.periodType, CHALLENGE_PERIOD_TYPES)),
	],
);

// usage_logs — 利用時間ログ。started_at/ended_at は timestamptz、duration_sec は終了時算出。
export const usageLogs = pgTable(
	'usage_logs',
	{
		familyId: uuid('family_id').notNull(),
		childId: uuid('child_id').notNull(),
		logId: uuid('log_id').notNull().default(sql`gen_random_uuid()`),
		startedAt: timestamp('started_at', { mode: 'string', withTimezone: true }).notNull(),
		endedAt: timestamp('ended_at', { mode: 'string', withTimezone: true }),
		durationSec: integer('duration_sec'),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.childId, t.logId] })],
);

// ── グローバル master (§11.2: tenant プレフィクスなし、自然キー PK) ──

// market_benchmarks — 年齢×カテゴリ別の市場ベンチマーク (グローバル master、tenant 非依存)。
// PK は自然キー (age, category_id) (§11.2「market_benchmarks(age,category_id) PK」/ §4)。
// category_id はグローバル master categories(code) への論理 FK (text、child_activities と同判断)。
// PK 凍結は GLOBAL_MASTER_PK_MANIFEST (pk-freeze-manifest.ts) で fitness#9 [3] が突合。
export const marketBenchmarks = pgTable(
	'market_benchmarks',
	{
		age: integer('age').notNull(),
		categoryId: text('category_id').notNull(),
		mean: real('mean').notNull(),
		stdDev: real('std_dev').notNull(),
		source: text('source'),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.age, t.categoryId] })],
);

// ── Family 系 8 表 (§11.2 #3557 確定 / 調査 SSOT: tmp/research-family-tables-pk-2026-07-03.md、#3424) ──
// settings のみ自然複合 (anchor (b) KVS 構造的確実性)、他 7 表は UUID surrogate。
// endpoint/token/pin の global UNIQUE は無 tenant 単点 lookup の機能要件 (§11.2)。

// settings — family KVS (自然複合 (family_id, key)、anchor (b))。
// ⚠️ sqlite 現行は tenant_id 列なし (key 単独 PK のグローバル KVS) — cutover で family_id を
// 追加する前提差分 (#3557 PR body で QM 確認済。単一家族 NUC は定数 family_id、§P10)。
export const settings = pgTable(
	'settings',
	{
		familyId: uuid('family_id').notNull(),
		key: text('key').notNull(),
		value: text('value').notNull(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.key] })],
);

// push_subscriptions — Web Push 購読 (UUID surrogate: endpoint は rotate される mutable)。
// endpoint は findByEndpoint が tenant 無しで値単独 lookup するため global UNIQUE 必須 (§11.2)。
export const pushSubscriptions = pgTable(
	'push_subscriptions',
	{
		familyId: uuid('family_id').notNull(),
		subscriptionId: uuid('subscription_id').notNull().default(sql`gen_random_uuid()`),
		endpoint: text('endpoint').notNull().unique(),
		keysP256dh: text('keys_p256dh').notNull(),
		keysAuth: text('keys_auth').notNull(),
		userAgent: text('user_agent'),
		subscriberRole: text('subscriber_role').notNull().default('parent'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.subscriptionId] })],
);

// notification_logs — 通知送信ログ (UUID surrogate: append-only log)。sent_at は sort 用途。
export const notificationLogs = pgTable(
	'notification_logs',
	{
		familyId: uuid('family_id').notNull(),
		logId: uuid('log_id').notNull().default(sql`gen_random_uuid()`),
		notificationType: text('notification_type').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		sentAt: timestamp('sent_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
		success: boolean('success').notNull().default(true),
		errorMessage: text('error_message'),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.logId] })],
);

// trial_history — トライアル履歴 (UUID surrogate: 1 tenant N 回)。tier/source/upgrade_reason は
// 増減集合 (plan lookup 方針 §6.6 / campaign 追加あり得る) のため CHECK 対象外。
// cross-tenant cron (findActiveTrials end_date) 用 secondary は §P5 計測後 (§11.2 #3557)。
export const trialHistory = pgTable(
	'trial_history',
	{
		familyId: uuid('family_id').notNull(),
		trialId: uuid('trial_id').notNull().default(sql`gen_random_uuid()`),
		startDate: text('start_date').notNull(),
		endDate: text('end_date').notNull(),
		tier: text('tier').notNull().default('standard'),
		source: text('source').notNull(),
		campaignId: text('campaign_id'),
		stripeSubscriptionId: text('stripe_subscription_id'),
		upgradeReason: text('upgrade_reason'),
		trialStartSource: text('trial_start_source'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.trialId] })],
);

// viewer_tokens — 閲覧専用リンク (UUID surrogate: token は revoke 後再発行あり)。
// token は findByToken が tenant 無しで値単独 lookup するため global UNIQUE 必須 (§11.2)。
// 失効判定は app 層述語 (revoked_at/expires_at 素の列、部分 index 不可 spike#2 §3.5.3)。
export const viewerTokens = pgTable(
	'viewer_tokens',
	{
		familyId: uuid('family_id').notNull(),
		tokenId: uuid('token_id').notNull().default(sql`gen_random_uuid()`),
		token: text('token').notNull().unique(),
		label: text('label'),
		expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		revokedAt: timestamp('revoked_at', { mode: 'string', withTimezone: true }),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.tokenId] })],
);

// cloud_exports — クラウドバックアップ export (UUID surrogate: pin は expire 後再利用)。
// pin_code は findByPin が tenant 無しで値単独 lookup するため global UNIQUE 必須。
// status は state machine (pending→building→ready/failed #3504/#3509) で SSOT 生成 CHECK。
// secondary(status) は cron drainPendingExports 用 (family 非依存の cross-tenant scan、§11.2 #3557)。
export const cloudExports = pgTable(
	'cloud_exports',
	{
		familyId: uuid('family_id').notNull(),
		exportId: uuid('export_id').notNull().default(sql`gen_random_uuid()`),
		exportType: text('export_type').notNull(),
		pinCode: text('pin_code').notNull().unique(),
		s3Key: text('s3_key').notNull(),
		fileSizeBytes: integer('file_size_bytes').notNull(),
		label: text('label'),
		description: text('description'),
		expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
		downloadCount: integer('download_count').notNull().default(0),
		maxDownloads: integer('max_downloads').notNull().default(10),
		status: text('status').notNull().default('pending').$type<CloudExportStatus>(),
		failureReason: text('failure_reason'),
		buildStartedAt: timestamp('build_started_at', { mode: 'string', withTimezone: true }),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.exportId] }),
		index('cloud_exports_status_idx').on(t.status),
		check('cloud_exports_status_ck', enumCheck(t.status, CLOUD_EXPORT_STATUSES)),
	],
);

// cancellation_reasons — 解約理由 (UUID surrogate: append-only、PO KPI 分析表)。
// category は KPI 分類で追加があり得る増減集合のため CHECK 対象外。
// cross-tenant 分析 secondary は §P5 計測後 (§11.2 #3557。hot path が cross-tenant である点は
// Family repo 実装 PR で明示)。
export const cancellationReasons = pgTable(
	'cancellation_reasons',
	{
		familyId: uuid('family_id').notNull(),
		reasonId: uuid('reason_id').notNull().default(sql`gen_random_uuid()`),
		category: text('category').notNull(),
		freeText: text('free_text'),
		planAtCancellation: text('plan_at_cancellation'),
		stripeSubscriptionId: text('stripe_subscription_id'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.reasonId] })],
);

// inquiries — 問い合わせ (#3612)。sqlite の settings KVS 間借り (`inquiry:` prefix JSON) を
// greenfield では専用表化する (account-lockout の専用表化と同 class 是正)。
// - PK = inquiry_id (text): 既存 interface 契約 `INQ-YYYYMMDD-seq` (app 側採番) を維持。
//   family_id 先頭でないため AUTH_PK_MANIFEST に凍結宣言 (fitness#9)。
// - family_id nullable: 未ログインの founder 導線 (/inquiry/founder) からも受けるため。
//   tenant 述語 fitness は INSERT の family_id 列存在で判定 (値 NULL は正当)。
// - backup 対象外 (backup-entity-registry `inquiry` excluded: 運用データ、家族データ外)。
export const inquiries = pgTable(
	'inquiries',
	{
		inquiryId: text('inquiry_id').notNull(),
		familyId: uuid('family_id'),
		email: text('email').notNull(),
		replyEmail: text('reply_email'),
		category: text('category').notNull(),
		body: text('body').notNull(),
		status: text('status').notNull().default('open'),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.inquiryId] }),
		check('inquiries_status_ck', enumCheck(t.status, INQUIRY_STATUSES)),
	],
);

// graduation_consent — 卒業同意 (UUID surrogate: 複数子×複数回で多数行が正)。
// secondary(consented, consented_at) は publicSamples/aggregate 用 (cross-tenant、§11.2 #3557)。
export const graduationConsent = pgTable(
	'graduation_consent',
	{
		familyId: uuid('family_id').notNull(),
		consentId: uuid('consent_id').notNull().default(sql`gen_random_uuid()`),
		nickname: text('nickname').notNull(),
		consented: boolean('consented').notNull().default(false),
		userPoints: integer('user_points').notNull().default(0),
		usagePeriodDays: integer('usage_period_days').notNull().default(0),
		message: text('message'),
		consentedAt: timestamp('consented_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.consentId] }),
		index('graduation_consent_public_idx').on(t.consented, t.consentedAt),
	],
);

// ── Family 方針 / 認証 / ライフサイクル 表 (M3 §1.1a 構造決定 = 別テーブル据置 baseline、#3424 M4-C) ──
// WriteDPU バイト課金 + 独立更新 + 概念独立ゆえ families 広幅行へ吸収しない (M3 §1.1a / U-4)。
// 各 (family_id) 1:1/1:0..1 表は PK covering の point-read。属性は M2 §1.1 の 3NF 分解に忠実。
// ⚠️ enum CHECK: SSOT 配列が存在する列のみ enumCheck で生成。SSOT 未整備の enum
//    (decay 強度 / lifecycle 状態 / 換算単位 / bonus 条件種別) は CHECK 省略 (ALTER ADD
//    CONSTRAINT で後付け可逆、§P1 の PK 凍結と異なり non-blocking)。手書き二重化はしない。

// parent_gate_credentials — 保護者ゲート PIN (family 1:1、ADR-0050)。PIN は平文非保持ハッシュ。
// 連続失敗/ロック解除時刻/リセット痕跡は素の列 (M2 §1.1 R-PARENT_GATE_CREDENTIAL)。
export const parentGateCredentials = pgTable(
	'parent_gate_credentials',
	{
		familyId: uuid('family_id').notNull(),
		pinHash: text('pin_hash').notNull(),
		failedAttempts: integer('failed_attempts').notNull().default(0),
		lockedUntil: timestamp('locked_until', { mode: 'string', withTimezone: true }),
		// 運用リセットの冪等印 (リセット適用痕跡、M2 §1.1)。
		resetTrace: text('reset_trace'),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// loyalty_state — ロイヤルティ (family 1:0..1)。記念チケット数は点数経済外の第 2 通貨カウンタ
// (D-BALANCE 非寄与、M2 §1.1 R-LOYALTY_STATE / D-LOYALTY)。
export const loyaltyState = pgTable(
	'loyalty_state',
	{
		familyId: uuid('family_id').notNull(),
		continuationMonths: integer('continuation_months').notNull().default(0),
		mementoTickets: integer('memento_tickets').notNull().default(0),
		lastGrantedMonth: text('last_granted_month'),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// account_lifecycle — アカウント状態機械 (family 1:1、I-LIFECYCLE)。状態 = active/soft-deleted/purged。
// 猶予プラン層は plan_tiers への論理 FK (DSQL FK 非対応、text)。CHECK は SSOT 未整備で省略。
export const accountLifecycle = pgTable(
	'account_lifecycle',
	{
		familyId: uuid('family_id').notNull(),
		state: text('state').notNull().default('active'),
		softDeletedAt: timestamp('soft_deleted_at', { mode: 'string', withTimezone: true }),
		// 猶予プラン層 → plan_tiers(plan_tier) 論理 FK (M2 [must]1 分解、猶予日数は tier で定まる)。
		gracePlanTier: text('grace_plan_tier'),
		// 物理削除予定日 (date 'YYYY-MM-DD')。
		purgeScheduledDate: text('purge_scheduled_date'),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// decay_policy — 減衰方針 (family 1:1、L-17)。強度 = none/gentle/normal/strict (DecayIntensity)。
// 猶予日数の既定 = DECAY_GRACE_DAYS(2)。CHECK は DecayIntensity SSOT が runtime 配列未整備で省略。
export const decayPolicy = pgTable(
	'decay_policy',
	{
		familyId: uuid('family_id').notNull(),
		intensity: text('intensity').notNull().default('normal'),
		graceDays: integer('grace_days').notNull().default(2),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// approval_policy — 承認方針 (family 1:0..1)。自動承認するか 真偽 (M2 §1.1 R-APPROVAL_POLICY)。
export const approvalPolicy = pgTable(
	'approval_policy',
	{
		familyId: uuid('family_id').notNull(),
		autoApprove: boolean('auto_approve').notNull().default(false),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// point_conversion_policy — ポイント換算方針 (family 1:0..1)。換算レートは real スカラー
// (JSON でない、M3 §1.1)。単位表示モード = point/currency (PointUnitMode)。CHECK は SSOT 配列
// 未整備で省略。
export const pointConversionPolicy = pgTable(
	'point_conversion_policy',
	{
		familyId: uuid('family_id').notNull(),
		unitMode: text('unit_mode').notNull().default('point'),
		currency: text('currency').notNull().default('JPY'),
		conversionRate: real('conversion_rate').notNull().default(1.0),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// notification_settings — 通知設定 (family 1:0..1)。⚠️ M3 §9 U-3 が M2 §1.1 の
// 静音開始/静音終了 2 列展開を **text 据置に override** (§4.2「全 JSON 列 text 据置」統一、
// 範囲 field query 0 件。将来 SQL 範囲比較が実発生したら ALTER ADD COLUMN で可逆展開)。
// → quiet_hours を単一 text 据置とする。reminder_time は scalar 時刻ゆえ素の text 列。
export const notificationSettings = pgTable(
	'notification_settings',
	{
		familyId: uuid('family_id').notNull(),
		reminderEnabled: boolean('reminder_enabled').notNull().default(false),
		reminderTime: text('reminder_time'),
		consecutiveEnabled: boolean('consecutive_enabled').notNull().default(false),
		// 静音時間帯 = 値オブジェクト text 据置 (M3 §9 U-3、M2 の 2 列展開を override)。
		quietHours: text('quiet_hours'),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId] })],
);

// bonus_rules — ボーナスルール群 (family master 1:N、ADR-0055)。⚠️ M3 §1.1 が発火条件を
// text 据置と確定 (M2 §1.1 の 発火条件_指標/閾値 2 列展開を override。field query 0 件 +
// 将来必要になれば可逆展開)。効果は記録時に基礎点へ畳み込む (独立台帳なし、L-19)。
// 条件種別 CHECK は SSOT 未整備で省略。
export const bonusRules = pgTable(
	'bonus_rules',
	{
		familyId: uuid('family_id').notNull(),
		ruleId: uuid('rule_id').notNull().default(sql`gen_random_uuid()`),
		conditionType: text('condition_type').notNull(),
		// 発火条件 = 値オブジェクト text 据置 (M3 §1.1、M2 の 指標/閾値 2 列展開を override)。
		triggerConfig: text('trigger_config'),
		bonusPoints: integer('bonus_points'),
		multiplier: real('multiplier'),
		isEnabled: boolean('is_enabled').notNull().default(true),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.familyId, t.ruleId] })],
);

// ── tenant 非依存 auth + グローバル master (§1.10 / §11.2 例外: family_id 先頭でない自然キー PK) ──
// GLOBAL_MASTER_PK_MANIFEST に凍結宣言 (family_id fitness allowlist 除外表、M3 §3.4)。

// email_login_lockouts — メールログインロック (家族非依存、PK = email、I-EMAIL-LOCK)。
// 未登録メールもロック対象になりうるため R-USER への FK は張らない (M2 §1.1 R-EMAIL_LOGIN_LOCKOUT)。
// 保護者ゲート PIN ロック (family 単位) とは別機構。
export const emailLoginLockouts = pgTable(
	'email_login_lockouts',
	{
		email: text('email').notNull(),
		failedAttempts: integer('failed_attempts').notNull().default(0),
		lockedUntil: timestamp('locked_until', { mode: 'string', withTimezone: true }),
		lastFailedAt: timestamp('last_failed_at', { mode: 'string', withTimezone: true }),
	},
	(t) => [primaryKey({ columns: [t.email] })],
);

// categories — カテゴリマスタ (グローバル master、PK = code 自然キー、固定 5 軸)。
// statuses/child_activities/market_benchmarks の category_id text 論理 FK 参照先。
export const categories = pgTable(
	'categories',
	{
		code: text('code').notNull(),
		name: text('name').notNull(),
		icon: text('icon'),
		color: text('color'),
	},
	(t) => [primaryKey({ columns: [t.code] })],
);

// stamp_masters — スタンプマスタ (グローバル master、PK = stamp_code 自然キー)。
// M2 §1.1 R-STAMP_MASTER PK={スタンプコード}。sqlite 現行の int id → 安定 stamp_code へ
// (cutover 写像)。stamp_entries.stamp_master_id (text) の論理参照先。rarity CHECK は SSOT
// 配列未整備で省略。
export const stampMasters = pgTable(
	'stamp_masters',
	{
		stampCode: text('stamp_code').notNull(),
		name: text('name').notNull(),
		emoji: text('emoji').notNull(),
		rarity: text('rarity').notNull(),
		isDefault: boolean('is_default').notNull().default(true),
		isEnabled: boolean('is_enabled').notNull().default(true),
		createdAt: timestamp('created_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.stampCode] })],
);

// plans — プラン参照 (グローバル lookup、PK = plan_code)。増減集合ゆえ CHECK でなく lookup 表
// (P1 の ALTER 後付け不可回避、M3 §1.10)。価格・カタログは課金 scope で defer (M2 §1.10)。
export const plans = pgTable(
	'plans',
	{
		planCode: text('plan_code').notNull(),
		// plan_tiers(plan_tier) への論理 FK (M2 §1.10 R-PLAN: プランコード → プラン層)。
		planTier: text('plan_tier').notNull(),
	},
	(t) => [primaryKey({ columns: [t.planCode] })],
);

// plan_tiers — プラン層 → 猶予日数 (グローバル lookup、PK = plan_tier、I-LIFECYCLE grounding)。
// M2 [must]1 で推移従属 (プランコード→プラン層→猶予日数) を分解し猶予日数を本表へ外出し。
export const planTiers = pgTable(
	'plan_tiers',
	{
		planTier: text('plan_tier').notNull(),
		graceDays: integer('grace_days').notNull(),
	},
	(t) => [primaryKey({ columns: [t.planTier] })],
);

// stripe_webhook_events — Stripe webhook 冪等 dedup (グローバル、PK = event_id、tenant_id は
// nullable analytics 属性)。at-least-once delivery + resend の二重課金防止。30 日 retention。
// handler_result は type-only enum (sqlite SSOT と同 shape、DDL CHECK は drizzle 仕様で非生成)。
export const stripeWebhookEvents = pgTable(
	'stripe_webhook_events',
	{
		eventId: text('event_id').notNull(),
		eventType: text('event_type').notNull(),
		processedAt: timestamp('processed_at', { mode: 'string', withTimezone: true })
			.notNull()
			.defaultNow(),
		handlerResult: text('handler_result', { enum: ['success', 'error', 'skipped'] }).notNull(),
		errorMessage: text('error_message'),
		retryCount: integer('retry_count').notNull().default(0),
		tenantId: text('tenant_id'),
	},
	(t) => [
		primaryKey({ columns: [t.eventId] }),
		index('stripe_webhook_events_processed_at_idx').on(t.processedAt),
		index('stripe_webhook_events_type_result_idx').on(t.eventType, t.handlerResult),
	],
);

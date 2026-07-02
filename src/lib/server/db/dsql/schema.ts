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
	uuid,
} from 'drizzle-orm/pg-core';
import { ARCHIVED_REASONS } from '$lib/domain/archive-types';
import {
	ALL_SUBSCRIPTION_STATUSES,
	type SubscriptionStatus,
} from '$lib/domain/constants/subscription-status';
import { UI_MODES } from '$lib/domain/validation/age-tier-types';
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

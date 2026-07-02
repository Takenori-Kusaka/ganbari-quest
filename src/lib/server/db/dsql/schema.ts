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
import { AUTH_PROVIDERS, type AuthProviderKind } from '$lib/server/auth/entities';
import { ROLES, type Role } from '$lib/server/auth/types';
import { enumCheck, THEME_KEYS } from './check-constraints';

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

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
	integer,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { ARCHIVED_REASONS } from '$lib/domain/archive-types';
import { UI_MODES } from '$lib/domain/validation/age-tier-types';
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

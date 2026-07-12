// src/lib/server/db/dsql/cancellation-reason-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ICancellationReasonRepo (cancellation_reasons) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: create / listByTenant / deleteByTenantId は family_id = tenantId を含む。
//     aggregateRecent / searchFreeText は PO KPI 分析用の cross-tenant scan (sqlite backend と
//     同 shape、schema §11.2 で「hot path が cross-tenant」と明示された例外)。
//   - **UUID surrogate PK**: reason_id は gen_random_uuid() 採番。entity.id = reason_id 文字列。
//   - **listByTenant / searchFreeText の「最新順」**: sqlite は id DESC (autoincrement = 挿入順)。
//     DSQL は created_at DESC + reason_id DESC tie-break で決定的に解決する。
//   - **breakdown は全カテゴリ 0 件初期化** (UI で 3 行常に表示、sqlite と同 JS ロジック共有)。
//   - **searchFreeText は ILIKE**: sqlite LIKE は ASCII case-insensitive のため pg では ILIKE が
//     同義 (pg LIKE は case-sensitive で挙動が変わる)。

import { sql } from 'drizzle-orm';
import type { CancellationCategory } from '$lib/domain/labels';
import { CANCELLATION_CATEGORIES } from '$lib/domain/labels';
import type {
	CancellationReasonAggregation,
	CancellationReasonRecord,
	ICancellationReasonRepo,
} from '../interfaces/cancellation-reason-repo.interface';
import type { SqlExecutor } from './sql-executor';

const DEFAULT_AGGREGATION_DAYS = 90;
const DEFAULT_FREE_TEXT_SEARCH_LIMIT = 50;

interface CancellationReasonRow {
	reason_id: string;
	family_id: string;
	category: string;
	free_text: string | null;
	plan_at_cancellation: string | null;
	stripe_subscription_id: string | null;
	created_at: string;
}

const REASON_COLUMNS = sql.raw(
	`reason_id, family_id, category, free_text, plan_at_cancellation,
	 stripe_subscription_id, created_at`,
);

/** row → CancellationReasonRecord entity (family_id → tenantId マップ)。 */
function toReason(row: CancellationReasonRow): CancellationReasonRecord {
	return {
		id: row.reason_id,
		tenantId: row.family_id,
		category: row.category as CancellationCategory,
		freeText: row.free_text,
		planAtCancellation: row.plan_at_cancellation,
		stripeSubscriptionId: row.stripe_subscription_id,
		createdAt: row.created_at,
	};
}

/** DSQL 用 ICancellationReasonRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlCancellationReasonRepo(db: SqlExecutor): ICancellationReasonRepo {
	return {
		async create(input) {
			const result = await db.execute(sql`
				INSERT INTO cancellation_reasons
					(family_id, category, free_text, plan_at_cancellation, stripe_subscription_id)
				VALUES (${input.tenantId}, ${input.category}, ${input.freeText ?? null},
					${input.planAtCancellation ?? null}, ${input.stripeSubscriptionId ?? null})
				RETURNING ${REASON_COLUMNS}
			`);
			const row = result.rows[0] as unknown as CancellationReasonRow | undefined;
			if (!row) throw new Error('Failed to create cancellation reason');
			return toReason(row);
		},

		async listByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${REASON_COLUMNS} FROM cancellation_reasons
				WHERE family_id = ${tenantId}
				ORDER BY created_at DESC, reason_id DESC
			`);
			return (result.rows as unknown as CancellationReasonRow[]).map(toReason);
		},

		async aggregateRecent(days = DEFAULT_AGGREGATION_DAYS) {
			const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
			const result = await db.execute(sql`
				SELECT category, count(*) AS c FROM cancellation_reasons
				WHERE created_at >= ${since}::timestamptz
				GROUP BY category
			`);
			const rows = result.rows as unknown as { category: string; c: unknown }[];
			const total = rows.reduce((sum, r) => sum + Number(r.c), 0);

			// 全カテゴリを 0 件で初期化してから集計値を埋める (UI で 3 行常に表示、sqlite と同ロジック)。
			const breakdown: CancellationReasonAggregation[] = CANCELLATION_CATEGORIES.map((cat) => {
				const found = rows.find((r) => r.category === cat);
				const count = found ? Number(found.c) : 0;
				return {
					category: cat,
					count,
					percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
				};
			});

			return { total, breakdown };
		},

		async searchFreeText(query, limit = DEFAULT_FREE_TEXT_SEARCH_LIMIT) {
			const trimmed = query.trim();
			const matchClause = trimmed ? sql` AND free_text ILIKE ${`%${trimmed}%`}` : sql``;
			const result = await db.execute(sql`
				SELECT ${REASON_COLUMNS} FROM cancellation_reasons
				WHERE free_text IS NOT NULL AND free_text != ''${matchClause}
				ORDER BY created_at DESC, reason_id DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as CancellationReasonRow[]).map(toReason);
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM cancellation_reasons WHERE family_id = ${tenantId}`);
		},
	};
}

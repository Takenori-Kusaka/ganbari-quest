// src/lib/server/db/dsql/activation-funnel-repo.ts
// EPIC #3424 / #3805: on-demand activation funnel の DSQL backend 実装。
//
// 設計契約 (dsql-data-model.md §11.2 cross-tenant 例外 / ADR-0065 DPU 規約):
//   - **factory 注入** (fitness#8)。単文 read のみ (txn runner 不要)。
//   - **cross-tenant 集計 (§11.2 例外)**: PO KPI 分析用途で families を tenant 横断走査する。
//     cancellation-reason-repo.aggregateRecent と同クラスの明示例外。
//   - **単一集約 SQL (ADR-0065: N+1 禁止)**: cohort → child / activity を CTE で 1 回に束ね、
//     4 段の件数を 1 クエリで返す。段ごとの per-tenant query は行わない。
//   - **created_at range で cohort を絞る**: families 全走査ではなく since 以降のみ。children /
//     activity_logs も cohort に JOIN して集約対象を cohort 家庭に限定する。
//   - **PGlite parity (ADR-0064)**: DSQL / NUC PGlite は本 repo を verbatim 共有。同 SQL が
//     両 pg backend で動く (make_interval / FILTER / timestamptz は pg 標準)。

import { sql } from 'drizzle-orm';
import type {
	ActivationFunnelCounts,
	IActivationFunnelRepo,
} from '../interfaces/activation-funnel-repo.interface';
import type { SqlExecutor } from './sql-executor';

interface FunnelRow {
	signup_count: number;
	first_child_count: number;
	first_activity_count: number;
	retained_count: number;
}

/** DSQL 用 IActivationFunnelRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlActivationFunnelRepo(db: SqlExecutor): IActivationFunnelRepo {
	return {
		async getActivationFunnelCounts(
			sinceIso: string,
			retentionDays: number,
		): Promise<ActivationFunnelCounts> {
			// 単一集約 SQL:
			//   cohort         = since 以降に登録した家庭 (signup 起点)
			//   child_flag     = cohort のうち子供を持つ家庭 (DISTINCT を cohort に限定)
			//   first_activity = cohort のうち初回 (非取消) 活動時刻 (MIN)
			// FILTER で signup + retentionDays 以内の初回活動を retention として数える。
			const result = await db.execute(sql`
				WITH cohort AS (
					SELECT family_id, created_at AS signup_at
					FROM families
					WHERE created_at >= ${sinceIso}::timestamptz
				),
				child_flag AS (
					SELECT DISTINCT ch.family_id
					FROM children ch
					JOIN cohort c2 ON c2.family_id = ch.family_id
				),
				first_activity AS (
					SELECT al.family_id, MIN(al.recorded_at) AS first_at
					FROM activity_logs al
					JOIN cohort c3 ON c3.family_id = al.family_id
					WHERE al.cancelled = false
					GROUP BY al.family_id
				)
				SELECT
					count(*)::int AS signup_count,
					count(cf.family_id)::int AS first_child_count,
					count(fa.family_id)::int AS first_activity_count,
					count(*) FILTER (
						WHERE fa.first_at IS NOT NULL
							AND fa.first_at <= c.signup_at + make_interval(days => ${retentionDays}::int)
					)::int AS retained_count
				FROM cohort c
				LEFT JOIN child_flag cf ON cf.family_id = c.family_id
				LEFT JOIN first_activity fa ON fa.family_id = c.family_id
			`);
			const row = result.rows[0] as unknown as FunnelRow | undefined;
			return {
				signupCount: Number(row?.signup_count ?? 0),
				firstChildCount: Number(row?.first_child_count ?? 0),
				firstActivityCount: Number(row?.first_activity_count ?? 0),
				retained7dCount: Number(row?.retained_count ?? 0),
			};
		},
	};
}

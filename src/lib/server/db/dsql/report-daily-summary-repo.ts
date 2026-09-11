// src/lib/server/db/dsql/report-daily-summary-repo.ts
// EPIC #3424 / cutover 配線 / 設計 SSOT: dsql-data-model.md §7 (read-model 廃止) / §P7 / §P9
//
// IReportDailySummaryRepo の DSQL backend 実装。**report_daily_summaries 表は DSQL に存在しない**
// (§7: Dynamo が GSI 回避で持たざるを得なかった read-model。DSQL では compute-on-read + index を
// 既定とし、まず廃止して実クエリ化を試す。恒常的に重ければマテビュー化)。本 repo は
// `activity_logs` × `child_activities` からの日次集計で ReportDailySummary shape を合成する。
//
// 設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。読み取り集計のみで
//     txn runner 不要。
//   - **§P9 tenant 述語**: 全クエリが family_id = tenantId を WHERE に含む。
//   - **集計母集合 = sqlite `findTodayLogsWithCategory` と同一意味論**: cancelled = false のみ、
//     かつ child_activities への INNER JOIN (削除済 activity の orphan log は数えない)。
//     row は「非 cancelled log が 1 件以上ある日」にのみ生成される (cron 未稼働の sqlite backend
//     には保存行が無く常に compute-on-read フォールバックだったため、保存行 parity は問わない)。
//   - **id = `${childId}:${date}` 合成** (interface が string を要求。consumer は等値比較しない)。
//
// field 別の導出可否 (§7 compute-on-read。捏造・近似を正確なふりで返さない):
//   - activityCount   … 導出可: 当日 log 件数 (cancelled 除外 + child_activities JOIN)。
//   - totalPoints     … 当日 points 列合計 (cancelled 除外。streak_bonus は ledger 側で別付与の
//                        ため含めない)。※ sqlite 側 cron writer は statuses.totalXp の累積
//                        snapshot を書いていたが、当日時点の累積は retroactive に再現不能。
//                        compute-on-read では「当日獲得 points 合計」の意味で返す。
//   - categoryBreakdown … 導出可: child_activities JOIN で category_id 別件数の JSON 文字列
//                        (sqlite writer の JSON.stringify(Record<categoryId, count>) と同 shape。
//                        jsonb_object_agg 経由のため区切り空白等の字面差はあるが parse 後同値)。
//   - checklistCompletion … '{}' 固定。sqlite writer (report-service aggregateChildDaily) も
//                        簡易実装で常に '{}' を保存しており、'{}' が正確な parity。
//   - streakDays      … 導出可: gaps-and-islands で「その日で終わる連続活動日数」を全履歴から
//                        再計算 (report-service calculateStreak と同一意味論、365 上限も一致)。
//   - level           … 既定値 1。当日時点の level snapshot は retroactive に再現不能
//                        (compute-on-read では当日 snapshot を再現しない。§7: 実クエリ化を試し、
//                        恒常的に必要ならマテビュー化)。**consumer (report-service) は表示レベルを
//                        この値から取らず、statuses から realtime 導出する (#4719)。**
//   - newAchievements … 0 固定 (実績システム廃止 #322。sqlite writer も常に 0 を書く正確な parity)。
//   - createdAt       … 当日最終 log の recorded_at (::text)。保存行が無いため生成時刻は持たない。
//
// upsert / deleteOlderThan / deleteByTenantId は書込対象表が存在しないため no-op
// (cron aggregateDailyReport からの upsert は compute-on-read 化で不要になる)。

import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import type { IReportDailySummaryRepo } from '../interfaces/report-daily-summary-repo.interface';
import type { ReportDailySummary } from '../types';
import type { SqlExecutor } from './sql-executor';

interface SummaryRow {
	child_id: string;
	date: string;
	activity_count: number;
	total_points: number;
	category_breakdown: string;
	streak_days: number;
	created_at: string;
}

/** row → ReportDailySummary (導出不能 field は上記ヘッダーコメントの既定値)。 */
function toSummary(row: SummaryRow, tenantId: string): ReportDailySummary {
	return {
		id: `${row.child_id}:${row.date}`,
		tenantId,
		childId: asChildId(row.child_id),
		date: row.date,
		activityCount: Number(row.activity_count),
		categoryBreakdown: row.category_breakdown,
		// sqlite writer parity: 常に '{}' (checklist 集計は sqlite 側でも簡易実装で未導出)
		checklistCompletion: '{}',
		// 当日 snapshot は再現不能 (ヘッダーコメント参照)。表示レベルは report-service が statuses から
		// realtime 導出する (#4719) ため、この値を UI に出さない。
		level: 1,
		totalPoints: Number(row.total_points),
		streakDays: Number(row.streak_days),
		newAchievements: 0,
		createdAt: row.created_at,
	};
}

/**
 * 日次集計クエリを組み立てる (by-child / by-tenant 共有)。
 *
 * - day_logs / category_counts: cancelled 除外 + child_activities INNER JOIN の日次 GROUP BY。
 * - streaks: gaps-and-islands (`date - ROW_NUMBER()` が連続日で一定になる性質) で
 *   「その日で終わる連続活動日数」を導出。island 判定は日付 range の外側も含む全履歴で行い、
 *   最後に range で絞る (range 先頭日の streak が途切れて見えないように)。365 上限は
 *   calculateStreak (report-service) の走査上限と同じ。
 */
function buildSummaryQuery(
	tenantId: string,
	childFilter: SQL,
	startDate: string,
	endDate: string,
): SQL {
	return sql`
		WITH day_logs AS (
			SELECT al.child_id,
				al.recorded_date AS date,
				COUNT(*)::int AS activity_count,
				SUM(al.points)::int AS total_points,
				MAX(al.recorded_at)::text AS created_at
			FROM activity_logs al
			JOIN child_activities ca
				ON ca.family_id = al.family_id
				AND ca.child_id = al.child_id
				AND ca.activity_id = al.activity_id
			WHERE al.family_id = ${tenantId} AND al.cancelled = false${childFilter}
			GROUP BY al.child_id, al.recorded_date
		),
		category_counts AS (
			SELECT al.child_id, al.recorded_date AS date, ca.category_id, COUNT(*)::int AS cnt
			FROM activity_logs al
			JOIN child_activities ca
				ON ca.family_id = al.family_id
				AND ca.child_id = al.child_id
				AND ca.activity_id = al.activity_id
			WHERE al.family_id = ${tenantId} AND al.cancelled = false${childFilter}
			GROUP BY al.child_id, al.recorded_date, ca.category_id
		),
		category_json AS (
			SELECT child_id, date, jsonb_object_agg(category_id, cnt)::text AS category_breakdown
			FROM category_counts
			GROUP BY child_id, date
		),
		streaks AS (
			SELECT child_id, date,
				LEAST(ROW_NUMBER() OVER (PARTITION BY child_id, grp ORDER BY date)::int, 365) AS streak_days
			FROM (
				SELECT child_id, date,
					date::date - (ROW_NUMBER() OVER (PARTITION BY child_id ORDER BY date))::int AS grp
				FROM day_logs
			) islands
		)
		SELECT d.child_id, d.date, d.activity_count, d.total_points, d.created_at,
			cj.category_breakdown, s.streak_days
		FROM day_logs d
		JOIN category_json cj ON cj.child_id = d.child_id AND cj.date = d.date
		JOIN streaks s ON s.child_id = d.child_id AND s.date = d.date
		WHERE d.date >= ${startDate} AND d.date <= ${endDate}
		ORDER BY d.child_id, d.date
	`;
}

/** DSQL 用 IReportDailySummaryRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlReportDailySummaryRepo(db: SqlExecutor): IReportDailySummaryRepo {
	return {
		async findByChildAndDateRange(
			childId: ChildId,
			startDate: string,
			endDate: string,
			tenantId: string,
		) {
			const result = await db.execute(
				buildSummaryQuery(tenantId, sql` AND al.child_id = ${childId}`, startDate, endDate),
			);
			return (result.rows as unknown as SummaryRow[]).map((r) => toSummary(r, tenantId));
		},

		async findByTenantAndDateRange(tenantId: string, startDate: string, endDate: string) {
			const result = await db.execute(buildSummaryQuery(tenantId, sql``, startDate, endDate));
			return (result.rows as unknown as SummaryRow[]).map((r) => toSummary(r, tenantId));
		},

		async upsert() {
			// no-op: 保存先の report_daily_summaries 表は DSQL に存在しない (§7 廃止)。
			// cron (report-service aggregateDailyReport) からの書込は compute-on-read 化で不要になる。
		},

		async deleteOlderThan() {
			// 保存データが無いため削除対象 0 件 (retention cleanup は no-op)。
			return 0;
		},

		async deleteByTenantId() {
			// no-op: 保存データなし (tenant cleanup で消すものが無い)。
		},
	};
}

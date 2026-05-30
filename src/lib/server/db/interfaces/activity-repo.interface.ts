import type { ArchivedReason } from '$lib/domain/archive-types';
import type {
	Activity,
	ActivityFilter,
	ActivityLog,
	ActivityLogSummary,
	Child,
	ChildActivity,
	InsertActivityInput,
	InsertActivityLogInput,
	InsertPointLedgerInput,
	UpdateActivityInput,
} from '../types';

export interface IActivityRepo {
	// Activities
	findActivities(tenantId: string, filter?: ActivityFilter): Promise<Activity[]>;
	// #2362 PR-3 Phase 7b-2c → #2458-A1/A2 (2026-05-26):
	// - sqlite: ChildActivity を `_toActivityShape` adapter 経由で Activity shape として返す
	//   (per-child instance ベース統一、#2458-A1 完遂)
	// - demo: legacy `ALL_DEMO_ACTIVITIES` (hand-curated DEMO_ACTIVITIES + marketplace merged)
	//   を返す (read 経路維持で marketplace integration テスト退行ゼロ)。per-child scope queries
	//   は別 file (demo/child-activity-repo.ts) 経由で DEMO_CHILD_ACTIVITIES から取得
	// - dynamodb: production 未使用 (ADR-0048) のため legacy Activity を Scan で返す
	//   (read のみ生存、write は全て NotImplementedError throw)
	// 共通 callsite は id / name / icon / basePoints / priority / isVisible のみ参照。
	// physical drop は #2458-C で実施予定。
	findActivityById(id: number, tenantId: string): Promise<Activity | ChildActivity | undefined>;
	insertActivity(input: InsertActivityInput, tenantId: string): Promise<Activity>;
	updateActivity(
		id: number,
		input: UpdateActivityInput,
		tenantId: string,
	): Promise<Activity | undefined>;
	setActivityVisibility(
		id: number,
		visible: boolean,
		tenantId: string,
	): Promise<Activity | undefined>;
	deleteActivity(id: number, tenantId: string): Promise<Activity | undefined>;
	hasActivityLogs(activityId: number, tenantId: string): Promise<boolean>;
	getActivityLogCounts(tenantId: string): Promise<Record<number, number>>;
	countMainQuestActivities(tenantId: string): Promise<number>;
	deleteDailyMissionsByActivity(activityId: number, tenantId: string): Promise<void>;

	// Children (convenience — shared lookup)
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;

	// Activity Logs
	findDailyLog(
		childId: number,
		activityId: number,
		date: string,
		tenantId: string,
	): Promise<ActivityLog | undefined>;
	findStreakLogs(
		childId: number,
		activityId: number,
		tenantId: string,
	): Promise<{ recordedDate: string }[]>;
	insertActivityLog(input: InsertActivityLogInput, tenantId: string): Promise<ActivityLog>;
	findActivityLogById(id: number, tenantId: string): Promise<ActivityLog | undefined>;
	markActivityLogCancelled(id: number, tenantId: string): Promise<void>;
	findActivityLogs(
		childId: number,
		tenantId: string,
		options?: { from?: string; to?: string },
	): Promise<ActivityLogSummary[]>;
	countTodayActiveRecords(
		childId: number,
		activityId: number,
		date: string,
		tenantId: string,
	): Promise<number>;
	getTodayActivityCountsByChild(
		childId: number,
		date: string,
		tenantId: string,
	): Promise<{ activityId: number; count: number }[]>;
	findTodayRecordedActivityIds(childId: number, today: string, tenantId: string): Promise<number[]>;

	// Aggregation queries
	findDistinctRecordedDates(childId: number, tenantId: string): Promise<{ recordedDate: string }[]>;
	countActiveActivityLogs(childId: number, tenantId: string): Promise<number>;
	getCategoryCountsByDate(
		childId: number,
		tenantId: string,
	): Promise<{ recordedDate: string; categoryCount: number }[]>;
	countDistinctCategories(childId: number, tenantId: string): Promise<number>;
	findTodayLogsWithCategory(
		childId: number,
		date: string,
		tenantId: string,
	): Promise<{ activityId: number; categoryId: number }[]>;
	getComboPointsGranted(
		childId: number,
		descriptionPrefix: string,
		tenantId: string,
	): Promise<number>;
	countActiveActivityLogsByCategory(
		childId: number,
		categoryId: number,
		tenantId: string,
	): Promise<number>;
	countPointLedgerEntriesByType(childId: number, type: string, tenantId: string): Promise<number>;
	countPointLedgerEntriesByTypeAndDate(
		childId: number,
		type: string,
		date: string,
		tenantId: string,
	): Promise<number>;

	// #1755 (#1709-A): 「今日のおやくそく」(priority='must') 集計
	/**
	 * priority='must' の活動全件と、`today` 当日に記録されたものを集計する。
	 *
	 * @param childId 対象の子供 id
	 * @param today  YYYY-MM-DD（達成判定に使う日付）
	 * @returns logged: 今日達成した must 活動数 / total: must 活動の総数 /
	 *          activities: must 活動 + 今日記録済みフラグ
	 */
	findMustActivitiesWithToday(
		childId: number,
		today: string,
		tenantId: string,
	): Promise<{
		logged: number;
		total: number;
		activities: Array<{ id: number; name: string; icon: string; loggedToday: number }>;
	}>;

	// #783: archive / restore
	// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
	archiveActivities(ids: number[], reason: ArchivedReason, tenantId: string): Promise<void>;
	restoreArchivedActivities(reason: ArchivedReason, tenantId: string): Promise<void>;

	// Point Ledger
	insertPointLedger(input: InsertPointLedgerInput, tenantId: string): Promise<void>;

	// Retention cleanup (#717, #729)
	/**
	 * 指定した子供の `recorded_date < cutoffDate` に該当する activity_logs を削除する。
	 * cutoffDate は `YYYY-MM-DD` 形式で、その日自体は削除対象に含まない（strict less than）。
	 * @returns 削除件数
	 */
	deleteActivityLogsBeforeDate(
		childId: number,
		cutoffDate: string,
		tenantId: string,
	): Promise<number>;
}

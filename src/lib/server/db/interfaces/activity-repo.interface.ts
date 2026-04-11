import type {
	Activity,
	ActivityFilter,
	ActivityLog,
	ActivityLogSummary,
	Child,
	InsertActivityInput,
	InsertActivityLogInput,
	InsertPointLedgerInput,
	UpdateActivityInput,
} from '../types';

export interface IActivityRepo {
	// Activities
	findActivities(tenantId: string, filter?: ActivityFilter): Promise<Activity[]>;
	findActivityById(id: number, tenantId: string): Promise<Activity | undefined>;
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

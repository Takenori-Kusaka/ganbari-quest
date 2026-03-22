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
	findActivities(filter?: ActivityFilter): Promise<Activity[]>;
	findActivityById(id: number): Promise<Activity | undefined>;
	insertActivity(input: InsertActivityInput): Promise<Activity>;
	updateActivity(id: number, input: UpdateActivityInput): Promise<Activity | undefined>;
	setActivityVisibility(id: number, visible: boolean): Promise<Activity | undefined>;
	deleteActivity(id: number): Promise<Activity | undefined>;
	hasActivityLogs(activityId: number): Promise<boolean>;
	getActivityLogCounts(): Promise<Record<number, number>>;
	deleteDailyMissionsByActivity(activityId: number): Promise<void>;

	// Children (convenience — shared lookup)
	findChildById(id: number): Promise<Child | undefined>;

	// Activity Logs
	findDailyLog(childId: number, activityId: number, date: string): Promise<ActivityLog | undefined>;
	findStreakLogs(childId: number, activityId: number): Promise<{ recordedDate: string }[]>;
	insertActivityLog(input: InsertActivityLogInput): Promise<ActivityLog>;
	findActivityLogById(id: number): Promise<ActivityLog | undefined>;
	markActivityLogCancelled(id: number): Promise<void>;
	findActivityLogs(
		childId: number,
		options?: { from?: string; to?: string },
	): Promise<ActivityLogSummary[]>;
	countTodayActiveRecords(childId: number, activityId: number, date: string): Promise<number>;
	getTodayActivityCountsByChild(
		childId: number,
		date: string,
	): Promise<{ activityId: number; count: number }[]>;
	findTodayRecordedActivityIds(childId: number, today: string): Promise<number[]>;

	// Aggregation queries
	findDistinctRecordedDates(childId: number): Promise<{ recordedDate: string }[]>;
	countActiveActivityLogs(childId: number): Promise<number>;
	getCategoryCountsByDate(
		childId: number,
	): Promise<{ recordedDate: string; categoryCount: number }[]>;
	countDistinctCategories(childId: number): Promise<number>;
	findTodayLogsWithCategory(
		childId: number,
		date: string,
	): Promise<{ activityId: number; categoryId: number }[]>;
	getComboPointsGranted(childId: number, descriptionPrefix: string): Promise<number>;

	// Point Ledger
	insertPointLedger(input: InsertPointLedgerInput): Promise<void>;
}

import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
	RestDay,
} from '../types';

export interface IEvaluationRepo {
	countActivitiesByCategory(
		childId: number,
		weekStart: string,
		weekEnd: string,
		tenantId: string,
	): Promise<CategoryActivityCount[]>;
	insertEvaluation(input: InsertEvaluationInput, tenantId: string): Promise<Evaluation>;
	findAllChildren(tenantId: string): Promise<Child[]>;
	findEvaluationsByChild(childId: number, limit: number, tenantId: string): Promise<Evaluation[]>;
	hasDecayRunToday(childId: number, today: string, tenantId: string): Promise<boolean>;
	findWeekEvaluation(
		childId: number,
		weekStart: string,
		tenantId: string,
	): Promise<{ id: number } | undefined>;
	findLastActivityDateByCategory(childId: number, tenantId: string): Promise<CategoryLastDate[]>;
	insertRestDay(
		childId: number,
		date: string,
		reason: string,
		tenantId: string,
	): Promise<RestDay | undefined>;
	deleteRestDay(childId: number, date: string, tenantId: string): Promise<void>;
	isRestDay(childId: number, date: string, tenantId: string): Promise<boolean>;
	countRestDaysInMonth(childId: number, yearMonth: string, tenantId: string): Promise<number>;
	findRestDays(childId: number, yearMonth: string, tenantId: string): Promise<RestDay[]>;

	/** #3329 backup: child の全おやすみ日 (月不問、export 用)。 */
	findRestDaysByChild(childId: number, tenantId: string): Promise<RestDay[]>;

	/**
	 * #3329 backup restore 用: createdAt を保全しておやすみ日を復元する。
	 * insertRestDay は createdAt を schema default (now) で発番するため round-trip で作成日時が
	 * 失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、childId は解決済)。
	 */
	insertRestDayForRestore(
		input: Omit<RestDay, 'id'>,
		tenantId: string,
	): Promise<RestDay | undefined>;

	deleteByTenantId(tenantId: string): Promise<void>;
}

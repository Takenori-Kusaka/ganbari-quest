import type { ChildId } from '$lib/domain/ids';
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
		childId: ChildId,
		weekStart: string,
		weekEnd: string,
		tenantId: string,
	): Promise<CategoryActivityCount[]>;
	insertEvaluation(input: InsertEvaluationInput, tenantId: string): Promise<Evaluation>;
	findAllChildren(tenantId: string): Promise<Child[]>;
	findEvaluationsByChild(childId: ChildId, limit: number, tenantId: string): Promise<Evaluation[]>;
	hasDecayRunToday(childId: ChildId, today: string, tenantId: string): Promise<boolean>;
	findWeekEvaluation(
		childId: ChildId,
		weekStart: string,
		tenantId: string,
	): Promise<{ id: string } | undefined>;
	findLastActivityDateByCategory(childId: ChildId, tenantId: string): Promise<CategoryLastDate[]>;
	insertRestDay(
		childId: ChildId,
		date: string,
		reason: string,
		tenantId: string,
	): Promise<RestDay | undefined>;
	deleteRestDay(childId: ChildId, date: string, tenantId: string): Promise<void>;
	isRestDay(childId: ChildId, date: string, tenantId: string): Promise<boolean>;
	countRestDaysInMonth(childId: ChildId, yearMonth: string, tenantId: string): Promise<number>;
	findRestDays(childId: ChildId, yearMonth: string, tenantId: string): Promise<RestDay[]>;

	/** #3329 backup: child の全おやすみ日 (月不問、export 用)。 */
	findRestDaysByChild(childId: ChildId, tenantId: string): Promise<RestDay[]>;

	/**
	 * #3329 backup restore 用: createdAt を保全しておやすみ日を復元する。
	 * insertRestDay は createdAt を schema default (now) で発番するため round-trip で作成日時が
	 * 失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、childId は解決済)。
	 */
	insertRestDayForRestore(
		input: Omit<RestDay, 'id'>,
		tenantId: string,
	): Promise<RestDay | undefined>;

	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}

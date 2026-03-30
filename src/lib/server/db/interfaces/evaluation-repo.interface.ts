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
}

import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
} from '../types';

export interface IEvaluationRepo {
	countActivitiesByCategory(
		childId: number,
		weekStart: string,
		weekEnd: string,
	): Promise<CategoryActivityCount[]>;
	insertEvaluation(input: InsertEvaluationInput): Promise<Evaluation>;
	findAllChildren(): Promise<Child[]>;
	findEvaluationsByChild(childId: number, limit: number): Promise<Evaluation[]>;
	hasDecayRunToday(childId: number, today: string): Promise<boolean>;
	findWeekEvaluation(childId: number, weekStart: string): Promise<{ id: number } | undefined>;
	findLastActivityDateByCategory(childId: number): Promise<CategoryLastDate[]>;
}

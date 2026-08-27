import type { ChildId } from '$lib/domain/ids';
import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
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
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}

import type {
	CareerField,
	CareerPlan,
	CareerPlanHistory,
	InsertCareerPlanHistoryInput,
	InsertCareerPlanInput,
	InsertCareerPointInput,
	PointLedgerEntry,
	UpdateCareerPlanInput,
} from '../types';

export interface ICareerRepo {
	// Career fields
	findAllCareerFields(): Promise<CareerField[]>;
	findCareerFieldsByAge(age: number): Promise<CareerField[]>;
	findCareerFieldById(id: number): Promise<CareerField | undefined>;

	// Career plans
	findActiveCareerPlan(childId: number): Promise<CareerPlan | undefined>;
	findCareerPlansByChildId(childId: number): Promise<CareerPlan[]>;
	insertCareerPlan(input: InsertCareerPlanInput): Promise<CareerPlan>;
	updateCareerPlan(planId: number, input: UpdateCareerPlanInput): Promise<CareerPlan | undefined>;
	deactivateCareerPlans(childId: number): Promise<void>;

	// Plan history
	insertCareerPlanHistory(input: InsertCareerPlanHistoryInput): Promise<CareerPlanHistory>;
	findLatestHistoryByAction(
		careerPlanId: number,
		action: string,
	): Promise<CareerPlanHistory | undefined>;

	// Points
	insertCareerPointEntry(input: InsertCareerPointInput): Promise<PointLedgerEntry>;
}

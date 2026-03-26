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
	// Career fields (global)
	findAllCareerFields(tenantId: string): Promise<CareerField[]>;
	findCareerFieldsByAge(age: number, tenantId: string): Promise<CareerField[]>;
	findCareerFieldById(id: number, tenantId: string): Promise<CareerField | undefined>;

	// Career plans
	findActiveCareerPlan(childId: number, tenantId: string): Promise<CareerPlan | undefined>;
	findCareerPlansByChildId(childId: number, tenantId: string): Promise<CareerPlan[]>;
	insertCareerPlan(input: InsertCareerPlanInput, tenantId: string): Promise<CareerPlan>;
	updateCareerPlan(
		planId: number,
		input: UpdateCareerPlanInput,
		tenantId: string,
	): Promise<CareerPlan | undefined>;
	deactivateCareerPlans(childId: number, tenantId: string): Promise<void>;

	// Plan history
	insertCareerPlanHistory(
		input: InsertCareerPlanHistoryInput,
		tenantId: string,
	): Promise<CareerPlanHistory>;
	findLatestHistoryByAction(
		careerPlanId: number,
		action: string,
		tenantId: string,
	): Promise<CareerPlanHistory | undefined>;

	// Points
	insertCareerPointEntry(
		input: InsertCareerPointInput,
		tenantId: string,
	): Promise<PointLedgerEntry>;
}

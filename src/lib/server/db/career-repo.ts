// src/lib/server/db/career-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertCareerPlanHistoryInput,
	InsertCareerPlanInput,
	InsertCareerPointInput,
	UpdateCareerPlanInput,
} from './types';

// Career fields
export async function findAllCareerFields(tenantId: string) {
	return getRepos().career.findAllCareerFields(tenantId);
}
export async function findCareerFieldsByAge(age: number, tenantId: string) {
	return getRepos().career.findCareerFieldsByAge(age, tenantId);
}
export async function findCareerFieldById(id: number, tenantId: string) {
	return getRepos().career.findCareerFieldById(id, tenantId);
}

// Career plans
export async function findActiveCareerPlan(childId: number, tenantId: string) {
	return getRepos().career.findActiveCareerPlan(childId, tenantId);
}
export async function findCareerPlansByChildId(childId: number, tenantId: string) {
	return getRepos().career.findCareerPlansByChildId(childId, tenantId);
}
export async function insertCareerPlan(input: InsertCareerPlanInput, tenantId: string) {
	return getRepos().career.insertCareerPlan(input, tenantId);
}
export async function updateCareerPlan(
	planId: number,
	input: UpdateCareerPlanInput,
	tenantId: string,
) {
	return getRepos().career.updateCareerPlan(planId, input, tenantId);
}
export async function deactivateCareerPlans(childId: number, tenantId: string) {
	return getRepos().career.deactivateCareerPlans(childId, tenantId);
}

// Plan history
export async function insertCareerPlanHistory(
	input: InsertCareerPlanHistoryInput,
	tenantId: string,
) {
	return getRepos().career.insertCareerPlanHistory(input, tenantId);
}
export async function findLatestHistoryByAction(
	careerPlanId: number,
	action: string,
	tenantId: string,
) {
	return getRepos().career.findLatestHistoryByAction(careerPlanId, action, tenantId);
}

// Points
export async function insertCareerPointEntry(input: InsertCareerPointInput, tenantId: string) {
	return getRepos().career.insertCareerPointEntry(input, tenantId);
}

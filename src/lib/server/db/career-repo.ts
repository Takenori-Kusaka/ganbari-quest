// src/lib/server/db/career-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertCareerPlanHistoryInput,
	InsertCareerPlanInput,
	InsertCareerPointInput,
	UpdateCareerPlanInput,
} from './types';

// Career fields
export async function findAllCareerFields() {
	return getRepos().career.findAllCareerFields();
}
export async function findCareerFieldsByAge(age: number) {
	return getRepos().career.findCareerFieldsByAge(age);
}
export async function findCareerFieldById(id: number) {
	return getRepos().career.findCareerFieldById(id);
}

// Career plans
export async function findActiveCareerPlan(childId: number) {
	return getRepos().career.findActiveCareerPlan(childId);
}
export async function findCareerPlansByChildId(childId: number) {
	return getRepos().career.findCareerPlansByChildId(childId);
}
export async function insertCareerPlan(input: InsertCareerPlanInput) {
	return getRepos().career.insertCareerPlan(input);
}
export async function updateCareerPlan(planId: number, input: UpdateCareerPlanInput) {
	return getRepos().career.updateCareerPlan(planId, input);
}
export async function deactivateCareerPlans(childId: number) {
	return getRepos().career.deactivateCareerPlans(childId);
}

// Plan history
export async function insertCareerPlanHistory(input: InsertCareerPlanHistoryInput) {
	return getRepos().career.insertCareerPlanHistory(input);
}
export async function findLatestHistoryByAction(careerPlanId: number, action: string) {
	return getRepos().career.findLatestHistoryByAction(careerPlanId, action);
}

// Points
export async function insertCareerPointEntry(input: InsertCareerPointInput) {
	return getRepos().career.insertCareerPointEntry(input);
}

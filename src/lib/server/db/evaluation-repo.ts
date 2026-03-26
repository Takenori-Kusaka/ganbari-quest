// src/lib/server/db/evaluation-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertEvaluationInput } from './types';

export async function countActivitiesByCategory(
	childId: number,
	weekStart: string,
	weekEnd: string,
	tenantId: string,
) {
	return getRepos().evaluation.countActivitiesByCategory(childId, weekStart, weekEnd, tenantId);
}
export async function insertEvaluation(input: InsertEvaluationInput, tenantId: string) {
	return getRepos().evaluation.insertEvaluation(input, tenantId);
}
export async function findAllChildren(tenantId: string) {
	return getRepos().evaluation.findAllChildren(tenantId);
}
export async function findEvaluationsByChild(childId: number, limit: number, tenantId: string) {
	return getRepos().evaluation.findEvaluationsByChild(childId, limit, tenantId);
}
export async function hasDecayRunToday(childId: number, today: string, tenantId: string) {
	return getRepos().evaluation.hasDecayRunToday(childId, today, tenantId);
}
export async function findWeekEvaluation(childId: number, weekStart: string, tenantId: string) {
	return getRepos().evaluation.findWeekEvaluation(childId, weekStart, tenantId);
}
export async function findLastActivityDateByCategory(childId: number, tenantId: string) {
	return getRepos().evaluation.findLastActivityDateByCategory(childId, tenantId);
}

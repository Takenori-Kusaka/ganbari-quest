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
export async function insertRestDay(
	childId: number,
	date: string,
	reason: string,
	tenantId: string,
) {
	return getRepos().evaluation.insertRestDay(childId, date, reason, tenantId);
}
export async function deleteRestDay(childId: number, date: string, tenantId: string) {
	return getRepos().evaluation.deleteRestDay(childId, date, tenantId);
}
export async function isRestDay(childId: number, date: string, tenantId: string) {
	return getRepos().evaluation.isRestDay(childId, date, tenantId);
}
export async function countRestDaysInMonth(childId: number, yearMonth: string, tenantId: string) {
	return getRepos().evaluation.countRestDaysInMonth(childId, yearMonth, tenantId);
}
export async function findRestDays(childId: number, yearMonth: string, tenantId: string) {
	return getRepos().evaluation.findRestDays(childId, yearMonth, tenantId);
}

// src/lib/server/db/evaluation-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertEvaluationInput } from './types';

export async function countActivitiesByCategory(
	childId: number,
	weekStart: string,
	weekEnd: string,
) {
	return getRepos().evaluation.countActivitiesByCategory(childId, weekStart, weekEnd);
}
export async function insertEvaluation(input: InsertEvaluationInput) {
	return getRepos().evaluation.insertEvaluation(input);
}
export async function findAllChildren() {
	return getRepos().evaluation.findAllChildren();
}
export async function findEvaluationsByChild(childId: number, limit: number) {
	return getRepos().evaluation.findEvaluationsByChild(childId, limit);
}
export async function hasDecayRunToday(childId: number, today: string) {
	return getRepos().evaluation.hasDecayRunToday(childId, today);
}
export async function findWeekEvaluation(childId: number, weekStart: string) {
	return getRepos().evaluation.findWeekEvaluation(childId, weekStart);
}
export async function findLastActivityDateByCategory(childId: number) {
	return getRepos().evaluation.findLastActivityDateByCategory(childId);
}

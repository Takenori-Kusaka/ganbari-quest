// src/lib/server/db/status-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertStatusHistoryInput } from './types';

export async function findStatuses(childId: number) {
	return getRepos().status.findStatuses(childId);
}
export async function findStatus(childId: number, categoryId: number) {
	return getRepos().status.findStatus(childId, categoryId);
}
export async function upsertStatus(childId: number, categoryId: number, value: number) {
	return getRepos().status.upsertStatus(childId, categoryId, value);
}
export async function insertStatusHistory(input: InsertStatusHistoryInput) {
	return getRepos().status.insertStatusHistory(input);
}
export async function findRecentStatusHistory(childId: number, categoryId: number, limit = 7) {
	return getRepos().status.findRecentStatusHistory(childId, categoryId, limit);
}
export async function findBenchmark(age: number, categoryId: number) {
	return getRepos().status.findBenchmark(age, categoryId);
}
export async function findAllBenchmarks() {
	return getRepos().status.findAllBenchmarks();
}
export async function upsertBenchmark(
	age: number,
	categoryId: number,
	mean: number,
	stdDev: number,
	source: string,
) {
	return getRepos().status.upsertBenchmark(age, categoryId, mean, stdDev, source);
}
export async function findChildById(id: number) {
	return getRepos().status.findChildById(id);
}
export async function findLastActivityDates(childId: number) {
	return getRepos().status.findLastActivityDates(childId);
}

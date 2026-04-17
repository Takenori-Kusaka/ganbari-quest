// src/lib/server/db/status-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertStatusHistoryInput } from './types';

export async function findStatuses(childId: number, tenantId: string) {
	return getRepos().status.findStatuses(childId, tenantId);
}
async function findStatus(childId: number, categoryId: number, tenantId: string) {
	return getRepos().status.findStatus(childId, categoryId, tenantId);
}
export async function upsertStatus(
	childId: number,
	categoryId: number,
	totalXp: number,
	level: number,
	peakXp: number,
	tenantId: string,
) {
	return getRepos().status.upsertStatus(childId, categoryId, totalXp, level, peakXp, tenantId);
}
export async function insertStatusHistory(input: InsertStatusHistoryInput, tenantId: string) {
	return getRepos().status.insertStatusHistory(input, tenantId);
}
export async function findRecentStatusHistory(
	childId: number,
	categoryId: number,
	tenantId: string,
	limit = 7,
) {
	return getRepos().status.findRecentStatusHistory(childId, categoryId, tenantId, limit);
}
export async function findStatusValueAtDate(
	childId: number,
	categoryId: number,
	beforeDate: string,
	tenantId: string,
) {
	return getRepos().status.findStatusValueAtDate(childId, categoryId, beforeDate, tenantId);
}
export async function findBenchmark(age: number, categoryId: number, tenantId: string) {
	return getRepos().status.findBenchmark(age, categoryId, tenantId);
}
export async function findAllBenchmarks(tenantId: string) {
	return getRepos().status.findAllBenchmarks(tenantId);
}
export async function upsertBenchmark(
	age: number,
	categoryId: number,
	mean: number,
	stdDev: number,
	source: string,
	tenantId: string,
) {
	return getRepos().status.upsertBenchmark(age, categoryId, mean, stdDev, source, tenantId);
}
export async function findChildById(id: number, tenantId: string) {
	return getRepos().status.findChildById(id, tenantId);
}
async function findLastActivityDates(childId: number, tenantId: string) {
	return getRepos().status.findLastActivityDates(childId, tenantId);
}

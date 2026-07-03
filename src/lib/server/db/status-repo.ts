import type { CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/db/status-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertStatusHistoryInput } from './types';

export async function findStatuses(childId: ChildId, tenantId: string) {
	return getRepos().status.findStatuses(childId, tenantId);
}
async function _findStatus(childId: ChildId, categoryId: CategoryId, tenantId: string) {
	return getRepos().status.findStatus(childId, categoryId, tenantId);
}
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertStatus(
	childId: ChildId,
	categoryId: CategoryId,
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
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
	limit = 7,
) {
	return getRepos().status.findRecentStatusHistory(childId, categoryId, tenantId, limit);
}
export async function findStatusValueAtDate(
	childId: ChildId,
	categoryId: CategoryId,
	beforeDate: string,
	tenantId: string,
) {
	return getRepos().status.findStatusValueAtDate(childId, categoryId, beforeDate, tenantId);
}
export async function findBenchmark(age: number, categoryId: CategoryId, tenantId: string) {
	return getRepos().status.findBenchmark(age, categoryId, tenantId);
}
export async function findAllBenchmarks(tenantId: string) {
	return getRepos().status.findAllBenchmarks(tenantId);
}
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertBenchmark(
	age: number,
	categoryId: CategoryId,
	mean: number,
	stdDev: number,
	source: string,
	tenantId: string,
) {
	return getRepos().status.upsertBenchmark(age, categoryId, mean, stdDev, source, tenantId);
}
export async function findChildById(id: ChildId, tenantId: string) {
	return getRepos().status.findChildById(id, tenantId);
}
async function _findLastActivityDates(childId: ChildId, tenantId: string) {
	return getRepos().status.findLastActivityDates(childId, tenantId);
}

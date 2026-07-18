import type { CategoryId, ChildId } from '$lib/domain/ids';
// Demo IStatusRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN, DEMO_STATUSES } from '$lib/server/demo/demo-data';
import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';

export async function findStatuses(childId: ChildId, _tenantId: string): Promise<Status[]> {
	return DEMO_STATUSES.filter((s) => s.childId === childId);
}

export async function findStatus(
	childId: ChildId,
	categoryId: CategoryId,
	_tenantId: string,
): Promise<Status | undefined> {
	return DEMO_STATUSES.find((s) => s.childId === childId && s.categoryId === categoryId);
}

// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertStatus(
	childId: ChildId,
	categoryId: CategoryId,
	totalXp: number,
	level: number,
	peakXp: number,
	_tenantId: string,
): Promise<Status> {
	return {
		id: '0',
		childId,
		categoryId,
		totalXp,
		level,
		peakXp,
		updatedAt: new Date().toISOString(),
	};
}

export async function insertStatusHistory(
	input: InsertStatusHistoryInput,
	_tenantId: string,
): Promise<StatusHistoryEntry> {
	return {
		id: '0',
		childId: input.childId,
		categoryId: input.categoryId,
		value: input.value,
		changeAmount: input.changeAmount,
		changeType: input.changeType,
		recordedAt: new Date().toISOString(),
	};
}

export async function findRecentStatusHistory(
	_childId: ChildId,
	_categoryId: CategoryId,
	_tenantId: string,
	_limit?: number,
): Promise<StatusHistoryEntry[]> {
	return [];
}

export async function findStatusValueAtDate(
	_childId: ChildId,
	_categoryId: CategoryId,
	_beforeDate: string,
	_tenantId: string,
): Promise<number | null> {
	return null;
}

export async function findBenchmark(
	_age: number,
	_categoryId: CategoryId,
	_tenantId: string,
): Promise<MarketBenchmark | undefined> {
	return undefined;
}

export async function findAllBenchmarks(_tenantId: string): Promise<MarketBenchmark[]> {
	return [];
}

// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function upsertBenchmark(
	age: number,
	categoryId: CategoryId,
	mean: number,
	stdDev: number,
	source: string,
	_tenantId: string,
): Promise<MarketBenchmark> {
	return {
		id: '0',
		age,
		categoryId,
		mean,
		stdDev,
		source,
		updatedAt: new Date().toISOString(),
	};
}

export async function findChildById(id: ChildId, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function findLastActivityDates(
	_childId: ChildId,
	_tenantId: string,
): Promise<{ category: number; lastDate: string | null }[]> {
	return [];
}

export async function deleteStatusHistoryBeforeDate(
	_childId: ChildId,
	_cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	// Stub: demo は書込 no-op のため削除件数 0 を返す。
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

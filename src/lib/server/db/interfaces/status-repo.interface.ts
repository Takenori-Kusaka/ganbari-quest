import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';

export interface IStatusRepo {
	findStatuses(childId: number, tenantId: string): Promise<Status[]>;
	findStatus(childId: number, categoryId: number, tenantId: string): Promise<Status | undefined>;
	upsertStatus(
		childId: number,
		categoryId: number,
		totalXp: number,
		level: number,
		peakXp: number,
		tenantId: string,
	): Promise<Status>;
	insertStatusHistory(
		input: InsertStatusHistoryInput,
		tenantId: string,
	): Promise<StatusHistoryEntry>;
	findRecentStatusHistory(
		childId: number,
		categoryId: number,
		tenantId: string,
		limit?: number,
	): Promise<StatusHistoryEntry[]>;
	findStatusValueAtDate(
		childId: number,
		categoryId: number,
		beforeDate: string,
		tenantId: string,
	): Promise<number | null>;
	findBenchmark(
		age: number,
		categoryId: number,
		tenantId: string,
	): Promise<MarketBenchmark | undefined>;
	findAllBenchmarks(tenantId: string): Promise<MarketBenchmark[]>;
	upsertBenchmark(
		age: number,
		categoryId: number,
		mean: number,
		stdDev: number,
		source: string,
		tenantId: string,
	): Promise<MarketBenchmark>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
	findLastActivityDates(
		childId: number,
		tenantId: string,
	): Promise<{ category: number; lastDate: string | null }[]>;
	deleteByTenantId(tenantId: string): Promise<void>;
}

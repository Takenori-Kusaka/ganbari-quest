import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';

export interface IStatusRepo {
	findStatuses(childId: number): Promise<Status[]>;
	findStatus(childId: number, categoryId: number): Promise<Status | undefined>;
	upsertStatus(childId: number, categoryId: number, value: number): Promise<Status>;
	insertStatusHistory(input: InsertStatusHistoryInput): Promise<StatusHistoryEntry>;
	findRecentStatusHistory(
		childId: number,
		categoryId: number,
		limit?: number,
	): Promise<StatusHistoryEntry[]>;
	findBenchmark(age: number, categoryId: number): Promise<MarketBenchmark | undefined>;
	findAllBenchmarks(): Promise<MarketBenchmark[]>;
	upsertBenchmark(
		age: number,
		categoryId: number,
		mean: number,
		stdDev: number,
		source: string,
	): Promise<MarketBenchmark>;
	findChildById(id: number): Promise<Child | undefined>;
	findLastActivityDates(childId: number): Promise<{ category: number; lastDate: string | null }[]>;
}

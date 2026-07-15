import type { CategoryId, ChildId } from '$lib/domain/ids';
import type {
	Child,
	InsertStatusHistoryInput,
	MarketBenchmark,
	Status,
	StatusHistoryEntry,
} from '../types';

export interface IStatusRepo {
	findStatuses(childId: ChildId, tenantId: string): Promise<Status[]>;
	findStatus(
		childId: ChildId,
		categoryId: CategoryId,
		tenantId: string,
	): Promise<Status | undefined>;
	upsertStatus(
		childId: ChildId,
		categoryId: CategoryId,
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
		childId: ChildId,
		categoryId: CategoryId,
		tenantId: string,
		limit?: number,
	): Promise<StatusHistoryEntry[]>;
	findStatusValueAtDate(
		childId: ChildId,
		categoryId: CategoryId,
		beforeDate: string,
		tenantId: string,
	): Promise<number | null>;
	findBenchmark(
		age: number,
		categoryId: CategoryId,
		tenantId: string,
	): Promise<MarketBenchmark | undefined>;
	findAllBenchmarks(tenantId: string): Promise<MarketBenchmark[]>;
	upsertBenchmark(
		age: number,
		categoryId: CategoryId,
		mean: number,
		stdDev: number,
		source: string,
		tenantId: string,
	): Promise<MarketBenchmark>;
	findChildById(id: ChildId, tenantId: string): Promise<Child | undefined>;
	/**
	 * カテゴリ別と命名されているが実際は **activityId keyed**（既存命名の歪み、全 backend parity）。
	 * `category` の型は歴史的に number (sqlite/dynamo の整数 activity id) だが、DSQL backend は
	 * activity_id が uuid (§P3) のため string を返す (#3424 PR-R4 で widening)。
	 */
	findLastActivityDates(
		childId: ChildId,
		tenantId: string,
	): Promise<{ category: number | string; lastDate: string | null }[]>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}

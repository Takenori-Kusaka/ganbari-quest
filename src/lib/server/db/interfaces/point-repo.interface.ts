import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export interface IPointRepo {
	getBalance(childId: number, tenantId: string): Promise<number>;
	findPointHistory(
		childId: number,
		options: { limit: number; offset: number },
		tenantId: string,
	): Promise<PointLedgerEntry[]>;
	insertPointEntry(input: InsertPointLedgerInput, tenantId: string): Promise<PointLedgerEntry>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
}

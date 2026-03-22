import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export interface IPointRepo {
	getBalance(childId: number): Promise<number>;
	findPointHistory(
		childId: number,
		options: { limit: number; offset: number },
	): Promise<PointLedgerEntry[]>;
	insertPointEntry(input: InsertPointLedgerInput): Promise<PointLedgerEntry>;
	findChildById(id: number): Promise<Child | undefined>;
}

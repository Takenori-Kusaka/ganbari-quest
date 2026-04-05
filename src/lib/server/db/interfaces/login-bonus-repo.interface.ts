import type { Child, InsertLoginBonusInput, LoginBonus } from '../types';

export interface ILoginBonusRepo {
	findTodayBonus(childId: number, today: string, tenantId: string): Promise<LoginBonus | undefined>;
	findRecentBonuses(childId: number, tenantId: string, limit?: number): Promise<LoginBonus[]>;
	insertLoginBonus(input: InsertLoginBonusInput, tenantId: string): Promise<LoginBonus>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string): Promise<void>;
}

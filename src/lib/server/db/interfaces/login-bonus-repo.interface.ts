import type { Child, InsertLoginBonusInput, LoginBonus } from '../types';

export interface ILoginBonusRepo {
	findTodayBonus(childId: number, today: string): Promise<LoginBonus | undefined>;
	findRecentBonuses(childId: number, limit?: number): Promise<LoginBonus[]>;
	insertLoginBonus(input: InsertLoginBonusInput): Promise<LoginBonus>;
	findChildById(id: number): Promise<Child | undefined>;
}

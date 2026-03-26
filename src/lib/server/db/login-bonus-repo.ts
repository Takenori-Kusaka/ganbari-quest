// src/lib/server/db/login-bonus-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertLoginBonusInput } from './types';

export async function findTodayBonus(childId: number, today: string, tenantId: string) {
	return getRepos().loginBonus.findTodayBonus(childId, today, tenantId);
}
export async function findRecentBonuses(childId: number, tenantId: string, limit = 60) {
	return getRepos().loginBonus.findRecentBonuses(childId, tenantId, limit);
}
export async function insertLoginBonus(input: InsertLoginBonusInput, tenantId: string) {
	return getRepos().loginBonus.insertLoginBonus(input, tenantId);
}
export async function findChildById(id: number, tenantId: string) {
	return getRepos().loginBonus.findChildById(id, tenantId);
}

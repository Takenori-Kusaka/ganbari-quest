// src/lib/server/db/login-bonus-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertLoginBonusInput } from './types';

export async function findTodayBonus(childId: number, today: string) {
	return getRepos().loginBonus.findTodayBonus(childId, today);
}
export async function findRecentBonuses(childId: number, limit = 60) {
	return getRepos().loginBonus.findRecentBonuses(childId, limit);
}
export async function insertLoginBonus(input: InsertLoginBonusInput) {
	return getRepos().loginBonus.insertLoginBonus(input);
}
export async function findChildById(id: number) {
	return getRepos().loginBonus.findChildById(id);
}

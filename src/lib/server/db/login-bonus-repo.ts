import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/login-bonus-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { UpsertLoginStreakInput } from './types';

export async function findStreak(childId: ChildId, tenantId: string) {
	return getRepos().loginBonus.findStreak(childId, tenantId);
}
export async function claimToday(
	childId: ChildId,
	today: string,
	yesterday: string,
	tenantId: string,
) {
	return getRepos().loginBonus.claimToday(childId, today, yesterday, tenantId);
}
export async function upsertStreak(input: UpsertLoginStreakInput, tenantId: string) {
	return getRepos().loginBonus.upsertStreak(input, tenantId);
}
export async function findChildById(id: ChildId, tenantId: string) {
	return getRepos().loginBonus.findChildById(id, tenantId);
}

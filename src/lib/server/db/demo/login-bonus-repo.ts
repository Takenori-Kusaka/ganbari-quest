// Demo ILoginBonusRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN, DEMO_LOGIN_BONUSES } from '$lib/server/demo/demo-data';
import type { Child, InsertLoginBonusInput, LoginBonus } from '../types';

export async function findTodayBonus(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<LoginBonus | undefined> {
	return DEMO_LOGIN_BONUSES.find((b) => b.childId === childId && b.loginDate === today);
}

export async function findRecentBonuses(
	childId: number,
	_tenantId: string,
	limit?: number,
): Promise<LoginBonus[]> {
	const filtered = DEMO_LOGIN_BONUSES.filter((b) => b.childId === childId);
	return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
}

export async function insertLoginBonus(
	input: InsertLoginBonusInput,
	_tenantId: string,
): Promise<LoginBonus> {
	return {
		id: 0,
		childId: input.childId,
		loginDate: input.loginDate,
		rank: input.rank,
		basePoints: input.basePoints,
		multiplier: input.multiplier,
		totalPoints: input.totalPoints,
		consecutiveDays: input.consecutiveDays,
		createdAt: new Date().toISOString(),
	};
}

export async function findChildById(id: number, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deleteLoginBonusesBeforeDate(
	_childId: number,
	_cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

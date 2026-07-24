import type { ChildId } from '$lib/domain/ids';
// Demo ILoginBonusRepo implementation (#3330 counter 縮約)
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN, DEMO_LOGIN_STREAKS } from '$lib/server/demo/demo-data';
import type { Child, LoginStreak, UpsertLoginStreakInput } from '../types';

export async function findStreak(
	childId: ChildId,
	_tenantId: string,
): Promise<LoginStreak | undefined> {
	return DEMO_LOGIN_STREAKS.find((s) => s.childId === childId);
}

export async function claimToday(
	childId: ChildId,
	today: string,
	yesterday: string,
	_tenantId: string,
): Promise<{ currentStreak: number } | undefined> {
	// Fake: fixture の counter 状態に対する conditional write 意味論を再現 (非永続)。
	const existing = DEMO_LOGIN_STREAKS.find((s) => s.childId === childId);
	if (existing?.lastLoginDate === today) return undefined;
	if (existing?.lastLoginDate === yesterday) return { currentStreak: existing.currentStreak + 1 };
	return { currentStreak: 1 };
}

export async function upsertStreak(
	_input: UpsertLoginStreakInput,
	_tenantId: string,
): Promise<boolean> {
	// Stub: no-op
	return true;
}

export async function findChildById(id: ChildId, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

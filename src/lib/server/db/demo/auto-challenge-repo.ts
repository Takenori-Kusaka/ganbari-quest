// Demo IAutoChallengeRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

export async function findByChildAndWeek(
	_childId: number,
	_weekStart: string,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	return undefined;
}

export async function findActiveByChild(
	_childId: number,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	return undefined;
}

export async function findByChild(
	_childId: number,
	_tenantId: string,
	_limit?: number,
): Promise<AutoChallenge[]> {
	return [];
}

export async function insert(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		tenantId,
		weekStart: input.weekStart,
		categoryId: input.categoryId,
		targetCount: input.targetCount,
		currentCount: 0,
		status: 'active',
		createdAt: now,
		updatedAt: now,
	};
}

export async function update(
	_id: number,
	_input: UpdateAutoChallengeInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function expireOldChallenges(_beforeDate: string, _tenantId: string): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

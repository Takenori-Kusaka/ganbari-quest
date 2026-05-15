// Demo ISiblingChallengeRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from '../types';

export async function findAllChallenges(_tenantId: string): Promise<SiblingChallenge[]> {
	return [];
}

export async function findActiveChallenges(
	_today: string,
	_tenantId: string,
): Promise<SiblingChallenge[]> {
	return [];
}

export async function findChallengeById(
	_id: number,
	_tenantId: string,
): Promise<SiblingChallenge | undefined> {
	return undefined;
}

export async function insertChallenge(
	input: InsertSiblingChallengeInput,
	_tenantId: string,
): Promise<SiblingChallenge> {
	const now = new Date().toISOString();
	return {
		id: 0,
		title: input.title,
		description: input.description ?? null,
		challengeType: input.challengeType ?? 'cooperative',
		periodType: input.periodType ?? 'weekly',
		startDate: input.startDate,
		endDate: input.endDate,
		targetConfig: input.targetConfig,
		rewardConfig: input.rewardConfig,
		status: 'active',
		isActive: 1,
		createdAt: now,
		updatedAt: now,
	};
}

export async function updateChallenge(
	_id: number,
	_input: UpdateSiblingChallengeInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteChallenge(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function findProgressByChallenge(
	_challengeId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return [];
}

export async function findProgressByChild(
	_childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return [];
}

export async function findProgress(
	_challengeId: number,
	_childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress | undefined> {
	return undefined;
}

export async function upsertProgress(
	_challengeId: number,
	_childId: number,
	_currentValue: number,
	_targetValue: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function markCompleted(
	_challengeId: number,
	_childId: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function claimReward(
	_challengeId: number,
	_childId: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function enrollChildren(
	_challengeId: number,
	_children: { childId: number; targetValue: number }[],
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

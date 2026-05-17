// Demo ISiblingChallengeRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// #2097 Phase B-5b: fixture を返すことで「きょうだいチャレンジ画面が空」のバグを解消。

import {
	DEMO_SIBLING_CHALLENGE_PROGRESSES,
	DEMO_SIBLING_CHALLENGES,
} from '$lib/server/demo/demo-data';
import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from '../types';

export async function findAllChallenges(_tenantId: string): Promise<SiblingChallenge[]> {
	return DEMO_SIBLING_CHALLENGES;
}

export async function findActiveChallenges(
	today: string,
	_tenantId: string,
): Promise<SiblingChallenge[]> {
	// active 判定: isActive=1 AND startDate <= today <= endDate
	return DEMO_SIBLING_CHALLENGES.filter(
		(c) => c.isActive === 1 && c.startDate <= today && today <= c.endDate,
	);
}

export async function findChallengeById(
	id: number,
	_tenantId: string,
): Promise<SiblingChallenge | undefined> {
	return DEMO_SIBLING_CHALLENGES.find((c) => c.id === id);
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
	challengeId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return DEMO_SIBLING_CHALLENGE_PROGRESSES.filter((p) => p.challengeId === challengeId);
}

export async function findProgressByChild(
	childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return DEMO_SIBLING_CHALLENGE_PROGRESSES.filter((p) => p.childId === childId);
}

export async function findProgress(
	challengeId: number,
	childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress | undefined> {
	return DEMO_SIBLING_CHALLENGE_PROGRESSES.find(
		(p) => p.challengeId === challengeId && p.childId === childId,
	);
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

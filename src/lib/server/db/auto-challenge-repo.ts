// src/lib/server/db/auto-challenge-repo.ts
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from './types';
import { getRepos } from './factory';

export async function findActiveChallenge(
	childId: number,
	today: string,
	tenantId: string,
): Promise<AutoChallenge | null> {
	return getRepos().autoChallenge.findActiveChallenge(childId, today, tenantId);
}

export async function findChallengesByChild(
	childId: number,
	tenantId: string,
): Promise<AutoChallenge[]> {
	return getRepos().autoChallenge.findChallengesByChild(childId, tenantId);
}

export async function findChallengeById(
	challengeId: number,
	tenantId: string,
): Promise<AutoChallenge | null> {
	return getRepos().autoChallenge.findChallengeById(challengeId, tenantId);
}

export async function insertChallenge(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	return getRepos().autoChallenge.insertChallenge(input, tenantId);
}

export async function updateChallenge(
	challengeId: number,
	input: UpdateAutoChallengeInput,
	tenantId: string,
): Promise<void> {
	return getRepos().autoChallenge.updateChallenge(challengeId, input, tenantId);
}

export async function expireOldChallenges(today: string, tenantId: string): Promise<number> {
	return getRepos().autoChallenge.expireOldChallenges(today, tenantId);
}

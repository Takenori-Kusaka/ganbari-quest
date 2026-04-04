// src/lib/server/db/dynamodb/auto-challenge-repo.ts
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

const NOT_IMPL = () => {
	throw new Error('auto-challenge-repo: DynamoDB not implemented');
};

export async function findActiveChallenge(
	_childId: number,
	_today: string,
	_tenantId: string,
): Promise<AutoChallenge | null> {
	NOT_IMPL();
	return null;
}

export async function findChallengesByChild(
	_childId: number,
	_tenantId: string,
): Promise<AutoChallenge[]> {
	NOT_IMPL();
	return [];
}

export async function findChallengeById(
	_challengeId: number,
	_tenantId: string,
): Promise<AutoChallenge | null> {
	NOT_IMPL();
	return null;
}

export async function insertChallenge(
	_input: InsertAutoChallengeInput,
	_tenantId: string,
): Promise<AutoChallenge> {
	NOT_IMPL();
	return undefined as unknown as AutoChallenge;
}

export async function updateChallenge(
	_challengeId: number,
	_input: UpdateAutoChallengeInput,
	_tenantId: string,
): Promise<void> {
	NOT_IMPL();
}

export async function expireOldChallenges(_today: string, _tenantId: string): Promise<number> {
	NOT_IMPL();
	return 0;
}

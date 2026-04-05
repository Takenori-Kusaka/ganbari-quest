// DynamoDB implementation of IAutoChallengeRepo (stub)

import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

const NOT_IMPL = 'auto-challenge-repo: DynamoDB not implemented';

export async function findByChildAndWeek(
	_childId: number,
	_weekStart: string,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findActiveByChild(
	_childId: number,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findByChild(
	_childId: number,
	_tenantId: string,
	_limit?: number,
): Promise<AutoChallenge[]> {
	throw new Error(NOT_IMPL);
}

export async function insert(
	_input: InsertAutoChallengeInput,
	_tenantId: string,
): Promise<AutoChallenge> {
	throw new Error(NOT_IMPL);
}

export async function update(
	_id: number,
	_input: UpdateAutoChallengeInput,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function expireOldChallenges(_beforeDate: string, _tenantId: string): Promise<number> {
	throw new Error(NOT_IMPL);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}

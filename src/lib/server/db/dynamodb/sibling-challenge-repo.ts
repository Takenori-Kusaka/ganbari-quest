// DynamoDB implementation of ISiblingChallengeRepo (stub)

import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from '../types';

const NOT_IMPL = 'sibling-challenge-repo: DynamoDB not implemented';

export async function findAllChallenges(_tenantId: string): Promise<SiblingChallenge[]> {
	throw new Error(NOT_IMPL);
}
export async function findActiveChallenges(
	_today: string,
	_tenantId: string,
): Promise<SiblingChallenge[]> {
	throw new Error(NOT_IMPL);
}
export async function findChallengeById(
	_id: number,
	_tenantId: string,
): Promise<SiblingChallenge | undefined> {
	throw new Error(NOT_IMPL);
}
export async function insertChallenge(
	_input: InsertSiblingChallengeInput,
	_tenantId: string,
): Promise<SiblingChallenge> {
	throw new Error(NOT_IMPL);
}
export async function updateChallenge(
	_id: number,
	_input: UpdateSiblingChallengeInput,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}
export async function deleteChallenge(_id: number, _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}
export async function findProgressByChallenge(
	_challengeId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	throw new Error(NOT_IMPL);
}
export async function findProgressByChild(
	_childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	throw new Error(NOT_IMPL);
}
export async function findProgress(
	_challengeId: number,
	_childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress | undefined> {
	throw new Error(NOT_IMPL);
}
export async function upsertProgress(
	_challengeId: number,
	_childId: number,
	_currentValue: number,
	_targetValue: number,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}
export async function markCompleted(
	_challengeId: number,
	_childId: number,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}
export async function claimReward(
	_challengeId: number,
	_childId: number,
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}
export async function enrollChildren(
	_challengeId: number,
	_children: { childId: number; targetValue: number }[],
	_tenantId: string,
): Promise<void> {
	throw new Error(NOT_IMPL);
}

/** テナントの全きょうだいチャレンジを削除（DynamoDB未実装: 書き込みがないため no-op） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// DynamoDB sibling-challenge repo は未実装のため書き込みデータなし — no-op
}

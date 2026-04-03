// src/lib/server/db/auto-challenge-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from './types';

export async function findByChildAndWeek(
	childId: number,
	weekStart: string,
	tenantId: string,
): Promise<AutoChallenge | undefined> {
	return getRepos().autoChallenge.findByChildAndWeek(childId, weekStart, tenantId);
}

export async function findActiveByChild(
	childId: number,
	tenantId: string,
): Promise<AutoChallenge | undefined> {
	return getRepos().autoChallenge.findActiveByChild(childId, tenantId);
}

export async function findByChild(
	childId: number,
	tenantId: string,
	limit?: number,
): Promise<AutoChallenge[]> {
	return getRepos().autoChallenge.findByChild(childId, tenantId, limit);
}

export async function insert(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	return getRepos().autoChallenge.insert(input, tenantId);
}

export async function update(
	id: number,
	input: UpdateAutoChallengeInput,
	tenantId: string,
): Promise<void> {
	return getRepos().autoChallenge.update(id, input, tenantId);
}

export async function expireOldChallenges(
	beforeDate: string,
	tenantId: string,
): Promise<number> {
	return getRepos().autoChallenge.expireOldChallenges(beforeDate, tenantId);
}

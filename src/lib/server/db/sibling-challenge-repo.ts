// src/lib/server/db/sibling-challenge-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from './types';

export async function findAllChallenges(tenantId: string): Promise<SiblingChallenge[]> {
	return getRepos().siblingChallenge.findAllChallenges(tenantId);
}

export async function findActiveChallenges(
	today: string,
	tenantId: string,
): Promise<SiblingChallenge[]> {
	return getRepos().siblingChallenge.findActiveChallenges(today, tenantId);
}

export async function findChallengeById(
	id: number,
	tenantId: string,
): Promise<SiblingChallenge | undefined> {
	return getRepos().siblingChallenge.findChallengeById(id, tenantId);
}

export async function insertChallenge(
	input: InsertSiblingChallengeInput,
	tenantId: string,
): Promise<SiblingChallenge> {
	return getRepos().siblingChallenge.insertChallenge(input, tenantId);
}

export async function updateChallenge(
	id: number,
	input: UpdateSiblingChallengeInput,
	tenantId: string,
): Promise<void> {
	return getRepos().siblingChallenge.updateChallenge(id, input, tenantId);
}

export async function deleteChallenge(id: number, tenantId: string): Promise<void> {
	return getRepos().siblingChallenge.deleteChallenge(id, tenantId);
}

export async function findProgressByChallenge(
	challengeId: number,
	tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return getRepos().siblingChallenge.findProgressByChallenge(challengeId, tenantId);
}

export async function findProgressByChild(
	childId: number,
	tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return getRepos().siblingChallenge.findProgressByChild(childId, tenantId);
}

export async function findProgress(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<SiblingChallengeProgress | undefined> {
	return getRepos().siblingChallenge.findProgress(challengeId, childId, tenantId);
}

export async function upsertProgress(
	challengeId: number,
	childId: number,
	currentValue: number,
	targetValue: number,
	tenantId: string,
): Promise<void> {
	return getRepos().siblingChallenge.upsertProgress(
		challengeId,
		childId,
		currentValue,
		targetValue,
		tenantId,
	);
}

export async function markCompleted(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<void> {
	return getRepos().siblingChallenge.markCompleted(challengeId, childId, tenantId);
}

export async function claimReward(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<void> {
	return getRepos().siblingChallenge.claimReward(challengeId, childId, tenantId);
}

export async function enrollChildren(
	challengeId: number,
	children: { childId: number; targetValue: number }[],
	tenantId: string,
): Promise<void> {
	return getRepos().siblingChallenge.enrollChildren(challengeId, children, tenantId);
}

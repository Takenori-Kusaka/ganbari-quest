// DynamoDB implementation of IChildChallengeRepo
//
// #2362 PR-7 / User §6: 旧 sibling-challenge-repo.dynamodb の per-child 後継。
// #2263 hotfix pattern: Pre-PMF fallback (read = 空 / write = no-op + logger.warn)。
// DynamoDB 本格対応は本番 PMF 後 (ADR-0010 Pre-PMF Bucket B)。

import { logger } from '$lib/server/logger';
import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';

const SERVICE = 'child-challenge-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2362)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2362)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function findByChildId(childId: number, tenantId: string): Promise<ChildChallenge[]> {
	warnRead('findByChildId', { childId, tenantId });
	return [];
}

export async function findActiveByChildId(
	childId: number,
	today: string,
	tenantId: string,
): Promise<ChildChallenge[]> {
	warnRead('findActiveByChildId', { childId, today, tenantId });
	return [];
}

export async function findAllByTenant(tenantId: string): Promise<ChildChallenge[]> {
	warnRead('findAllByTenant', { tenantId });
	return [];
}

export async function findById(id: number, tenantId: string): Promise<ChildChallenge | undefined> {
	warnRead('findById', { id, tenantId });
	return undefined;
}

export async function insert(
	input: InsertChildChallengeInput,
	tenantId: string,
): Promise<ChildChallenge> {
	warnWrite('insert', { childId: input.childId, title: input.title, tenantId });
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
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
		sourceTemplateId: input.sourceTemplateId ?? null,
		currentValue: 0,
		targetValue: input.targetValue,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function insertBulk(
	inputs: readonly InsertChildChallengeInput[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	warnWrite('insertBulk', { count: inputs.length, tenantId });
	const results: ChildChallenge[] = [];
	for (const input of inputs) {
		results.push(await insert(input, tenantId));
	}
	return results;
}

export async function updateProgress(
	id: number,
	currentValue: number,
	tenantId: string,
): Promise<void> {
	warnWrite('updateProgress', { id, currentValue, tenantId });
}

export async function markCompleted(id: number, tenantId: string): Promise<void> {
	warnWrite('markCompleted', { id, tenantId });
}

export async function claimReward(id: number, tenantId: string): Promise<void> {
	warnWrite('claimReward', { id, tenantId });
}

export async function update(
	id: number,
	_input: UpdateChildChallengeInput,
	tenantId: string,
): Promise<void> {
	warnWrite('update', { id, tenantId });
}

export async function deleteChallenge(id: number, tenantId: string): Promise<void> {
	warnWrite('delete', { id, tenantId });
}

export async function copyAcrossChildren(
	sourceChildId: number,
	targetChildId: number,
	tenantId: string,
): Promise<ChildChallenge[]> {
	warnWrite('copyAcrossChildren', { sourceChildId, targetChildId, tenantId });
	return [];
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}

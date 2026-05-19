// DynamoDB implementation of ISiblingChallengeRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// きょうだいチャレンジ機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from '../types';

const SERVICE = 'sibling-challenge-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function findAllChallenges(tenantId: string): Promise<SiblingChallenge[]> {
	warnRead('findAllChallenges', { tenantId });
	return [];
}

export async function findActiveChallenges(
	today: string,
	tenantId: string,
): Promise<SiblingChallenge[]> {
	warnRead('findActiveChallenges', { today, tenantId });
	return [];
}

export async function findChallengeById(
	id: number,
	tenantId: string,
): Promise<SiblingChallenge | undefined> {
	warnRead('findChallengeById', { id, tenantId });
	return undefined;
}

export async function insertChallenge(
	input: InsertSiblingChallengeInput,
	tenantId: string,
): Promise<SiblingChallenge> {
	warnWrite('insertChallenge', { title: input.title, tenantId });
	const now = new Date().toISOString();
	return {
		id: 0,
		title: input.title,
		description: input.description ?? null,
		challengeType: input.challengeType ?? 'count',
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
	id: number,
	_input: UpdateSiblingChallengeInput,
	tenantId: string,
): Promise<void> {
	warnWrite('updateChallenge', { id, tenantId });
}

export async function deleteChallenge(id: number, tenantId: string): Promise<void> {
	warnWrite('deleteChallenge', { id, tenantId });
}

export async function findProgressByChallenge(
	challengeId: number,
	tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	warnRead('findProgressByChallenge', { challengeId, tenantId });
	return [];
}

export async function findProgressByChild(
	childId: number,
	tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	warnRead('findProgressByChild', { childId, tenantId });
	return [];
}

export async function findProgress(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<SiblingChallengeProgress | undefined> {
	warnRead('findProgress', { challengeId, childId, tenantId });
	return undefined;
}

export async function upsertProgress(
	challengeId: number,
	childId: number,
	currentValue: number,
	targetValue: number,
	tenantId: string,
): Promise<void> {
	warnWrite('upsertProgress', { challengeId, childId, currentValue, targetValue, tenantId });
}

export async function markCompleted(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<void> {
	warnWrite('markCompleted', { challengeId, childId, tenantId });
}

export async function claimReward(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<void> {
	warnWrite('claimReward', { challengeId, childId, tenantId });
}

export async function enrollChildren(
	challengeId: number,
	children: { childId: number; targetValue: number }[],
	tenantId: string,
): Promise<void> {
	warnWrite('enrollChildren', { challengeId, childrenCount: children.length, tenantId });
}

/** テナントの全きょうだいチャレンジを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}

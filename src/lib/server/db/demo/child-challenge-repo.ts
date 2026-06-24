// Demo IChildChallengeRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// #2362 PR-7 / User §6: 旧 sibling-challenge-repo の per-child instance 後継。
// demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) で空配列を返し、
// admin/challenges 画面の empty state (テンプレ取込 CTA) を表示する。
// Phase 2 で per-child fixture を追加予定。

import { DEMO_CHILD_CHALLENGES } from '$lib/server/demo/demo-data';
import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';

export async function findByChildId(childId: number, _tenantId: string): Promise<ChildChallenge[]> {
	return DEMO_CHILD_CHALLENGES.filter((c) => c.childId === childId);
}

export async function findActiveByChildId(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	return DEMO_CHILD_CHALLENGES.filter(
		(c) =>
			c.childId === childId &&
			c.isActive === 1 &&
			c.status === 'active' &&
			c.startDate <= today &&
			today <= c.endDate,
	);
}

/** #2488 (must-1 fix): demo Lambda 環境向け。完成済 + 未請求 instance も含める。 */
export async function findActiveOrUnclaimedByChildId(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	return DEMO_CHILD_CHALLENGES.filter(
		(c) =>
			c.childId === childId &&
			c.isActive === 1 &&
			c.startDate <= today &&
			today <= c.endDate &&
			(c.status === 'active' || (c.status === 'completed' && c.rewardClaimed === 0)),
	);
}

export async function findAllByTenant(_tenantId: string): Promise<ChildChallenge[]> {
	return DEMO_CHILD_CHALLENGES;
}

export async function findById(id: number, _tenantId: string): Promise<ChildChallenge | undefined> {
	return DEMO_CHILD_CHALLENGES.find((c) => c.id === id);
}

export async function insert(
	input: InsertChildChallengeInput,
	_tenantId: string,
): Promise<ChildChallenge> {
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

/**
 * #3245: auto:weekly の atomic get-or-create (demo stub)。
 * demo は read=fixture / write=stub のため、当週 fixture があればそれを返し、無ければ insert stub を返す。
 */
export async function getOrCreateWeeklyAuto(
	input: InsertChildChallengeInput,
	tenantId: string,
): Promise<ChildChallenge> {
	const existing = DEMO_CHILD_CHALLENGES.find(
		(c) =>
			c.childId === input.childId &&
			c.startDate === input.startDate &&
			c.sourceTemplateId === (input.sourceTemplateId ?? 'auto:weekly'),
	);
	if (existing) return existing;
	return insert(input, tenantId);
}

export async function insertBulk(
	inputs: readonly InsertChildChallengeInput[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	const results: ChildChallenge[] = [];
	for (const input of inputs) {
		results.push(await insert(input, tenantId));
	}
	return results;
}

export async function updateProgress(
	_id: number,
	_currentValue: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function markCompleted(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function claimReward(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function update(
	_id: number,
	_input: UpdateChildChallengeInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteChallenge(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function copyAcrossChildren(
	_sourceChildId: number,
	_targetChildId: number,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	// Stub: 空配列を返す (write 失敗扱いではなく、demo 環境では copy しても永続しない)
	return [];
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

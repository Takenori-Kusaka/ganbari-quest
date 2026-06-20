// Demo IAutoChallengeRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// #2097 Phase B-4: read API returns DEMO_AUTO_CHALLENGES fixture so that
//   - 子供画面 (achievements page) で「今週のチャレンジ」が常に表示される
//   - getOrCreateWeeklyChallenge が当週 challenge を見つけ insert (no-op stub) に
//     落ちなくなる (落ちても結果は同一だが、副作用ログを抑制できる)

import { DEMO_AUTO_CHALLENGES } from '$lib/server/demo/demo-data';
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

export async function findByChildAndWeek(
	childId: number,
	weekStart: string,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	return DEMO_AUTO_CHALLENGES.find((c) => c.childId === childId && c.weekStart === weekStart);
}

export async function findActiveByChild(
	childId: number,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	// sqlite 実装と同じく weekStart desc で最新 1 件
	const candidates = DEMO_AUTO_CHALLENGES.filter(
		(c) => c.childId === childId && c.status === 'active',
	).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
	return candidates[0];
}

export async function findByChild(
	childId: number,
	_tenantId: string,
	limit = 10,
): Promise<AutoChallenge[]> {
	// sqlite 実装と同じく weekStart desc + limit
	return DEMO_AUTO_CHALLENGES.filter((c) => c.childId === childId)
		.sort((a, b) => b.weekStart.localeCompare(a.weekStart))
		.slice(0, limit);
}

export async function insert(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		tenantId,
		weekStart: input.weekStart,
		categoryId: input.categoryId,
		targetCount: input.targetCount,
		currentCount: 0,
		status: 'active',
		mode: input.mode ?? 'weakness',
		consecutiveMissCount: input.consecutiveMissCount ?? 0,
		createdAt: now,
		updatedAt: now,
	};
}

export async function update(
	_id: number,
	_input: UpdateAutoChallengeInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function expireOldChallenges(_beforeDate: string, _tenantId: string): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

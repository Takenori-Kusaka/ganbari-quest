// src/lib/server/db/sqlite/child-challenge-repo.ts
// per-child challenge instance repository — SQLite 実装 (#2362 PR-7, ADR-0055, User §6)
//
// 旧 `sibling-challenge-repo.ts` (family-wide + per-child progress 別 table) の後継。
// `childId` 必須 + tenant isolation を強制し、cross-child access を構造的に防ぐ。
//
// 並存原則: 旧 sibling_challenges / sibling_challenge_progress は drop しない (#2458 cleanup PR)。

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../client';
import { childChallenges } from '../schema';
import type {
	ChildChallenge,
	InsertChildChallengeInput,
	UpdateChildChallengeInput,
} from '../types';

export async function findByChildId(childId: number, _tenantId: string): Promise<ChildChallenge[]> {
	return db
		.select()
		.from(childChallenges)
		.where(eq(childChallenges.childId, childId))
		.orderBy(childChallenges.startDate)
		.all();
}

export async function findActiveByChildId(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<ChildChallenge[]> {
	return db
		.select()
		.from(childChallenges)
		.where(
			and(
				eq(childChallenges.childId, childId),
				eq(childChallenges.isActive, 1),
				eq(childChallenges.status, 'active'),
				lte(childChallenges.startDate, today),
				gte(childChallenges.endDate, today),
			),
		)
		.all();
}

export async function findAllByTenant(_tenantId: string): Promise<ChildChallenge[]> {
	// SQLite はシングルテナント (#1923 等の整合)。tenant_id 列なし、全件返す。
	return db.select().from(childChallenges).orderBy(childChallenges.createdAt).all();
}

export async function findById(id: number, _tenantId: string): Promise<ChildChallenge | undefined> {
	return db.select().from(childChallenges).where(eq(childChallenges.id, id)).get();
}

export async function insert(
	input: InsertChildChallengeInput,
	_tenantId: string,
): Promise<ChildChallenge> {
	const now = new Date().toISOString();
	const row = db
		.insert(childChallenges)
		.values({
			childId: input.childId,
			title: input.title,
			description: input.description ?? null,
			challengeType: input.challengeType ?? 'cooperative',
			periodType: input.periodType ?? 'weekly',
			startDate: input.startDate,
			endDate: input.endDate,
			targetConfig: input.targetConfig,
			rewardConfig: input.rewardConfig,
			sourceTemplateId: input.sourceTemplateId ?? null,
			currentValue: 0,
			targetValue: input.targetValue,
			completed: 0,
			rewardClaimed: 0,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
	if (!row) throw new Error('insert: insert returned no row');
	return row;
}

export async function insertBulk(
	inputs: readonly InsertChildChallengeInput[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	if (inputs.length === 0) return [];
	const results: ChildChallenge[] = [];
	for (const input of inputs) {
		results.push(await insert(input, tenantId));
	}
	return results;
}

export async function updateProgress(
	id: number,
	currentValue: number,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ currentValue, updatedAt: now })
		.where(eq(childChallenges.id, id))
		.run();
}

export async function markCompleted(id: number, _tenantId: string): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ completed: 1, completedAt: now, status: 'completed', updatedAt: now })
		.where(eq(childChallenges.id, id))
		.run();
}

export async function claimReward(id: number, _tenantId: string): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ rewardClaimed: 1, rewardClaimedAt: now, updatedAt: now })
		.where(eq(childChallenges.id, id))
		.run();
}

export async function update(
	id: number,
	input: UpdateChildChallengeInput,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(childChallenges)
		.set({ ...input, updatedAt: now })
		.where(eq(childChallenges.id, id))
		.run();
}

export async function deleteChallenge(id: number, _tenantId: string): Promise<void> {
	db.delete(childChallenges).where(eq(childChallenges.id, id)).run();
}

/**
 * source child の challenge 全件を target child に複製 (兄弟共通化 UX、User §6)。
 * sourceTemplateId を維持 + 進捗は currentValue=0 にリセット。
 */
export async function copyAcrossChildren(
	sourceChildId: number,
	targetChildId: number,
	tenantId: string,
): Promise<ChildChallenge[]> {
	const source = await findByChildId(sourceChildId, tenantId);
	if (source.length === 0) return [];

	const inputs: InsertChildChallengeInput[] = source.map((c) => ({
		childId: targetChildId,
		title: c.title,
		description: c.description,
		challengeType: c.challengeType,
		periodType: c.periodType,
		startDate: c.startDate,
		endDate: c.endDate,
		targetConfig: c.targetConfig,
		rewardConfig: c.rewardConfig,
		sourceTemplateId: c.sourceTemplateId,
		targetValue: c.targetValue,
	}));

	return insertBulk(inputs, tenantId);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// シングルテナント SQLite では全件削除
	db.delete(childChallenges).run();
}

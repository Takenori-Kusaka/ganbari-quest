// SQLite implementation of IAutoChallengeRepo

import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '../client';
import { autoChallenges } from '../schema';
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

export async function findByChildAndWeek(
	childId: number,
	weekStart: string,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	return db
		.select()
		.from(autoChallenges)
		.where(and(eq(autoChallenges.childId, childId), eq(autoChallenges.weekStart, weekStart)))
		.get() as AutoChallenge | undefined;
}

export async function findActiveByChild(
	childId: number,
	_tenantId: string,
): Promise<AutoChallenge | undefined> {
	return db
		.select()
		.from(autoChallenges)
		.where(and(eq(autoChallenges.childId, childId), eq(autoChallenges.status, 'active')))
		.orderBy(desc(autoChallenges.weekStart))
		.limit(1)
		.get() as AutoChallenge | undefined;
}

export async function findByChild(
	childId: number,
	_tenantId: string,
	limit = 10,
): Promise<AutoChallenge[]> {
	return db
		.select()
		.from(autoChallenges)
		.where(eq(autoChallenges.childId, childId))
		.orderBy(desc(autoChallenges.weekStart))
		.limit(limit)
		.all() as AutoChallenge[];
}

export async function insert(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	const now = new Date().toISOString();
	const result = db
		.insert(autoChallenges)
		.values({
			childId: input.childId,
			tenantId,
			weekStart: input.weekStart,
			categoryId: input.categoryId,
			targetCount: input.targetCount,
			currentCount: 0,
			status: 'active',
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
	return result as AutoChallenge;
}

export async function update(
	id: number,
	input: UpdateAutoChallengeInput,
	_tenantId: string,
): Promise<void> {
	db.update(autoChallenges)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(autoChallenges.id, id))
		.run();
}

export async function expireOldChallenges(beforeDate: string, _tenantId: string): Promise<number> {
	const result = db
		.update(autoChallenges)
		.set({ status: 'expired', updatedAt: new Date().toISOString() })
		.where(and(eq(autoChallenges.status, 'active'), lt(autoChallenges.weekStart, beforeDate)))
		.run();
	return result.changes;
}

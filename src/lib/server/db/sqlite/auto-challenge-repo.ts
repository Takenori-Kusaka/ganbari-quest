// src/lib/server/db/sqlite/auto-challenge-repo.ts
import { and, eq, lt, sql } from 'drizzle-orm';
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';
import { getDb } from '../client';
import { autoChallenges } from '../schema';

export async function findActiveChallenge(
	childId: number,
	today: string,
	tenantId: string,
): Promise<AutoChallenge | null> {
	const db = getDb();
	const rows = await db
		.select()
		.from(autoChallenges)
		.where(
			and(
				eq(autoChallenges.childId, childId),
				eq(autoChallenges.tenantId, tenantId),
				eq(autoChallenges.status, 'active'),
				sql`${autoChallenges.startDate} <= ${today}`,
				sql`${autoChallenges.endDate} >= ${today}`,
			),
		)
		.limit(1);
	return (rows[0] as AutoChallenge) ?? null;
}

export async function findChallengesByChild(
	childId: number,
	tenantId: string,
): Promise<AutoChallenge[]> {
	const db = getDb();
	const rows = await db
		.select()
		.from(autoChallenges)
		.where(and(eq(autoChallenges.childId, childId), eq(autoChallenges.tenantId, tenantId)))
		.orderBy(sql`${autoChallenges.createdAt} DESC`);
	return rows as AutoChallenge[];
}

export async function findChallengeById(
	challengeId: number,
	tenantId: string,
): Promise<AutoChallenge | null> {
	const db = getDb();
	const rows = await db
		.select()
		.from(autoChallenges)
		.where(and(eq(autoChallenges.id, challengeId), eq(autoChallenges.tenantId, tenantId)))
		.limit(1);
	return (rows[0] as AutoChallenge) ?? null;
}

export async function insertChallenge(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	const db = getDb();
	const result = await db
		.insert(autoChallenges)
		.values({
			childId: input.childId,
			tenantId,
			title: input.title,
			description: input.description ?? null,
			categoryId: input.categoryId ?? null,
			targetCount: input.targetCount,
			currentCount: 0,
			status: 'active',
			startDate: input.startDate,
			endDate: input.endDate,
			rewardPoints: input.rewardPoints ?? 50,
			rewardClaimed: 0,
		})
		.returning();
	return result[0] as AutoChallenge;
}

export async function updateChallenge(
	challengeId: number,
	input: UpdateAutoChallengeInput,
	tenantId: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(autoChallenges)
		.set({
			...input,
			updatedAt: sql`CURRENT_TIMESTAMP`,
		})
		.where(and(eq(autoChallenges.id, challengeId), eq(autoChallenges.tenantId, tenantId)));
}

export async function expireOldChallenges(today: string, tenantId: string): Promise<number> {
	const db = getDb();
	const result = await db
		.update(autoChallenges)
		.set({
			status: 'expired',
			updatedAt: sql`CURRENT_TIMESTAMP`,
		})
		.where(
			and(
				eq(autoChallenges.tenantId, tenantId),
				eq(autoChallenges.status, 'active'),
				lt(autoChallenges.endDate, today),
			),
		);
	return result.changes;
}

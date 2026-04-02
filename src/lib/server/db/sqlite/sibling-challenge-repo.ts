// SQLite implementation of ISiblingChallengeRepo

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../client';
import { siblingChallengeProgress, siblingChallenges } from '../schema';
import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from '../types';

export async function findAllChallenges(_tenantId: string): Promise<SiblingChallenge[]> {
	return db
		.select()
		.from(siblingChallenges)
		.orderBy(siblingChallenges.createdAt)
		.all() as SiblingChallenge[];
}

export async function findActiveChallenges(
	today: string,
	_tenantId: string,
): Promise<SiblingChallenge[]> {
	return db
		.select()
		.from(siblingChallenges)
		.where(
			and(
				eq(siblingChallenges.isActive, 1),
				eq(siblingChallenges.status, 'active'),
				lte(siblingChallenges.startDate, today),
				gte(siblingChallenges.endDate, today),
			),
		)
		.all() as SiblingChallenge[];
}

export async function findChallengeById(
	id: number,
	_tenantId: string,
): Promise<SiblingChallenge | undefined> {
	return db.select().from(siblingChallenges).where(eq(siblingChallenges.id, id)).get() as
		| SiblingChallenge
		| undefined;
}

export async function insertChallenge(
	input: InsertSiblingChallengeInput,
	_tenantId: string,
): Promise<SiblingChallenge> {
	const now = new Date().toISOString();
	return db
		.insert(siblingChallenges)
		.values({
			title: input.title,
			description: input.description ?? null,
			challengeType: input.challengeType ?? 'cooperative',
			periodType: input.periodType ?? 'weekly',
			startDate: input.startDate,
			endDate: input.endDate,
			targetConfig: input.targetConfig,
			rewardConfig: input.rewardConfig,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get() as SiblingChallenge;
}

export async function updateChallenge(
	id: number,
	input: UpdateSiblingChallengeInput,
	_tenantId: string,
): Promise<void> {
	db.update(siblingChallenges)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(siblingChallenges.id, id))
		.run();
}

export async function deleteChallenge(id: number, _tenantId: string): Promise<void> {
	db.delete(siblingChallengeProgress).where(eq(siblingChallengeProgress.challengeId, id)).run();
	db.delete(siblingChallenges).where(eq(siblingChallenges.id, id)).run();
}

export async function findProgressByChallenge(
	challengeId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return db
		.select()
		.from(siblingChallengeProgress)
		.where(eq(siblingChallengeProgress.challengeId, challengeId))
		.all() as SiblingChallengeProgress[];
}

export async function findProgressByChild(
	childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress[]> {
	return db
		.select()
		.from(siblingChallengeProgress)
		.where(eq(siblingChallengeProgress.childId, childId))
		.all() as SiblingChallengeProgress[];
}

export async function findProgress(
	challengeId: number,
	childId: number,
	_tenantId: string,
): Promise<SiblingChallengeProgress | undefined> {
	return db
		.select()
		.from(siblingChallengeProgress)
		.where(
			and(
				eq(siblingChallengeProgress.challengeId, challengeId),
				eq(siblingChallengeProgress.childId, childId),
			),
		)
		.get() as SiblingChallengeProgress | undefined;
}

export async function upsertProgress(
	challengeId: number,
	childId: number,
	currentValue: number,
	targetValue: number,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.insert(siblingChallengeProgress)
		.values({ challengeId, childId, currentValue, targetValue, updatedAt: now })
		.onConflictDoUpdate({
			target: [siblingChallengeProgress.challengeId, siblingChallengeProgress.childId],
			set: { currentValue, updatedAt: now },
		})
		.run();
}

export async function markCompleted(
	challengeId: number,
	childId: number,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(siblingChallengeProgress)
		.set({ completed: 1, completedAt: now, updatedAt: now })
		.where(
			and(
				eq(siblingChallengeProgress.challengeId, challengeId),
				eq(siblingChallengeProgress.childId, childId),
			),
		)
		.run();
}

export async function claimReward(
	challengeId: number,
	childId: number,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(siblingChallengeProgress)
		.set({ rewardClaimed: 1, rewardClaimedAt: now, updatedAt: now })
		.where(
			and(
				eq(siblingChallengeProgress.challengeId, challengeId),
				eq(siblingChallengeProgress.childId, childId),
			),
		)
		.run();
}

export async function enrollChildren(
	challengeId: number,
	children: { childId: number; targetValue: number }[],
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	for (const child of children) {
		db.insert(siblingChallengeProgress)
			.values({
				challengeId,
				childId: child.childId,
				currentValue: 0,
				targetValue: child.targetValue,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.run();
	}
}

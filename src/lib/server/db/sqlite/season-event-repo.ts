// SQLite implementation of ISeasonEventRepo

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../client';
import { childEventProgress, seasonEvents } from '../schema';
import type {
	ChildEventProgress,
	InsertSeasonEventInput,
	SeasonEvent,
	UpdateSeasonEventInput,
} from '../types';

export async function findAllEvents(_tenantId: string): Promise<SeasonEvent[]> {
	return db.select().from(seasonEvents).all() as SeasonEvent[];
}

export async function findActiveEvents(today: string, _tenantId: string): Promise<SeasonEvent[]> {
	return db
		.select()
		.from(seasonEvents)
		.where(
			and(
				eq(seasonEvents.isActive, 1),
				lte(seasonEvents.startDate, today),
				gte(seasonEvents.endDate, today),
			),
		)
		.all() as SeasonEvent[];
}

export async function findEventById(
	id: number,
	_tenantId: string,
): Promise<SeasonEvent | undefined> {
	return db.select().from(seasonEvents).where(eq(seasonEvents.id, id)).get() as
		| SeasonEvent
		| undefined;
}

export async function findEventByCode(
	code: string,
	_tenantId: string,
): Promise<SeasonEvent | undefined> {
	return db.select().from(seasonEvents).where(eq(seasonEvents.code, code)).get() as
		| SeasonEvent
		| undefined;
}

export async function insertEvent(
	input: InsertSeasonEventInput,
	_tenantId: string,
): Promise<SeasonEvent> {
	const now = new Date().toISOString();
	const result = db
		.insert(seasonEvents)
		.values({
			code: input.code,
			name: input.name,
			description: input.description ?? null,
			eventType: input.eventType ?? 'seasonal',
			startDate: input.startDate,
			endDate: input.endDate,
			bannerIcon: input.bannerIcon ?? '🎉',
			bannerColor: input.bannerColor ?? null,
			themeConfig: input.themeConfig ?? null,
			rewardConfig: input.rewardConfig ?? null,
			missionConfig: input.missionConfig ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
	return result as SeasonEvent;
}

export async function updateEvent(
	id: number,
	input: UpdateSeasonEventInput,
	_tenantId: string,
): Promise<void> {
	db.update(seasonEvents)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(seasonEvents.id, id))
		.run();
}

export async function deleteEvent(id: number, _tenantId: string): Promise<void> {
	db.delete(childEventProgress).where(eq(childEventProgress.eventId, id)).run();
	db.delete(seasonEvents).where(eq(seasonEvents.id, id)).run();
}

export async function findChildProgress(
	childId: number,
	eventId: number,
	_tenantId: string,
): Promise<ChildEventProgress | undefined> {
	return db
		.select()
		.from(childEventProgress)
		.where(and(eq(childEventProgress.childId, childId), eq(childEventProgress.eventId, eventId)))
		.get() as ChildEventProgress | undefined;
}

export async function findChildActiveEvents(
	childId: number,
	today: string,
	_tenantId: string,
): Promise<ChildEventProgress[]> {
	return db
		.select({ progress: childEventProgress })
		.from(childEventProgress)
		.innerJoin(seasonEvents, eq(childEventProgress.eventId, seasonEvents.id))
		.where(
			and(
				eq(childEventProgress.childId, childId),
				eq(seasonEvents.isActive, 1),
				lte(seasonEvents.startDate, today),
				gte(seasonEvents.endDate, today),
			),
		)
		.all()
		.map((r) => r.progress) as ChildEventProgress[];
}

export async function upsertChildProgress(
	childId: number,
	eventId: number,
	status: string,
	progressJson: string | null,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.insert(childEventProgress)
		.values({ childId, eventId, status, progressJson, joinedAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: [childEventProgress.childId, childEventProgress.eventId],
			set: { status, progressJson, updatedAt: now },
		})
		.run();
}

export async function claimReward(
	childId: number,
	eventId: number,
	_tenantId: string,
): Promise<void> {
	const now = new Date().toISOString();
	db.update(childEventProgress)
		.set({ status: 'reward_claimed', rewardClaimedAt: now, updatedAt: now })
		.where(and(eq(childEventProgress.childId, childId), eq(childEventProgress.eventId, eventId)))
		.run();
}

/** テナントの全シーズンイベントデータを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(childEventProgress).run();
	db.delete(seasonEvents).run();
}

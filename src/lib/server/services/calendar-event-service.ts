// src/lib/server/services/calendar-event-service.ts
// Calendar Event Service — manages season events from the master calendar.
// Replaces the old manual event creation flow with auto-delivered seasonal events.

import {
	type SeasonEventDefinition,
	SEASON_EVENTS,
	getActiveSeasonEvents,
	getEventDateRange,
} from '$lib/domain/season-event-calendar';
import {
	findByEventCode,
	findByTenantAndYear,
	findProgress,
	findProgressByChild,
	updateEvent,
	upsertEvent,
	upsertProgress,
} from '$lib/server/db/tenant-event-repo';
import type {
	TenantEvent,
	TenantEventProgress,
} from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

// ============================================================
// Types
// ============================================================

export interface CalendarEventWithStatus {
	definition: SeasonEventDefinition;
	tenantEvent: TenantEvent | null;
	enabled: boolean;
	rewardMemo: string | null;
	startDate: string;
	endDate: string;
	year: number;
}

export interface CalendarEventProgressInfo {
	eventCode: string;
	eventName: string;
	eventIcon: string;
	missionDescription: string;
	targetCount: number;
	currentCount: number;
	completed: boolean;
	completedAt: string | null;
	rewardMemo: string | null;
}

// ============================================================
// Admin (parent) functions
// ============================================================

/**
 * Get all calendar events that are currently active for the given date,
 * along with their tenant-level enabled/disabled status.
 */
export async function getActiveCalendarEvents(
	tenantId: string,
	date: Date = new Date(),
): Promise<CalendarEventWithStatus[]> {
	const activeEvents = getActiveSeasonEvents(date);
	const year = date.getFullYear();
	const tenantEvents = await findByTenantAndYear(tenantId, year);

	const tenantEventMap = new Map<string, TenantEvent>();
	for (const te of tenantEvents) {
		tenantEventMap.set(te.eventCode, te);
	}

	return activeEvents.map((def) => {
		const te = tenantEventMap.get(def.id) ?? null;
		const { startDate, endDate } = getEventDateRange(def, year);
		return {
			definition: def,
			tenantEvent: te,
			enabled: te ? te.enabled === 1 : true, // Default: enabled
			rewardMemo: te?.rewardMemo ?? null,
			startDate,
			endDate,
			year,
		};
	});
}

/**
 * Get ALL calendar events for a year (for admin panel), not just currently active.
 */
export async function getAllCalendarEventsForYear(
	tenantId: string,
	year: number,
): Promise<CalendarEventWithStatus[]> {
	const tenantEvents = await findByTenantAndYear(tenantId, year);

	const tenantEventMap = new Map<string, TenantEvent>();
	for (const te of tenantEvents) {
		tenantEventMap.set(te.eventCode, te);
	}

	return SEASON_EVENTS.map((def) => {
		const te = tenantEventMap.get(def.id) ?? null;
		const { startDate, endDate } = getEventDateRange(def, year);
		return {
			definition: def,
			tenantEvent: te,
			enabled: te ? te.enabled === 1 : true,
			rewardMemo: te?.rewardMemo ?? null,
			startDate,
			endDate,
			year,
		};
	});
}

/**
 * Toggle an event on/off for a tenant.
 */
export async function toggleEvent(
	tenantId: string,
	eventCode: string,
	enabled: boolean,
	year?: number,
): Promise<void> {
	const y = year ?? new Date().getFullYear();
	await upsertEvent(
		{
			eventCode,
			year: y,
			enabled: enabled ? 1 : 0,
		},
		tenantId,
	);
	logger.info('[calendar-event] Event toggled', {
		context: { tenantId, eventCode, enabled, year: y },
	});
}

/**
 * Set a reward memo (parent's promise) for an event.
 */
export async function setEventRewardMemo(
	tenantId: string,
	eventCode: string,
	memo: string | null,
	year?: number,
): Promise<void> {
	const y = year ?? new Date().getFullYear();

	const existing = await findByEventCode(tenantId, eventCode, y);
	if (existing) {
		await updateEvent(existing.id, { rewardMemo: memo }, tenantId);
	} else {
		await upsertEvent(
			{
				eventCode,
				year: y,
				enabled: 1,
				rewardMemo: memo,
			},
			tenantId,
		);
	}

	logger.info('[calendar-event] Reward memo set', {
		context: { tenantId, eventCode, memo, year: y },
	});
}

// ============================================================
// Child-facing functions
// ============================================================

/**
 * Get active calendar event progress for a child.
 * Only returns events that are:
 * 1. Active based on current date
 * 2. Not disabled by the parent
 */
export async function getChildEventProgress(
	childId: number,
	tenantId: string,
	date: Date = new Date(),
): Promise<CalendarEventProgressInfo[]> {
	const activeEventsWithStatus = await getActiveCalendarEvents(tenantId, date);
	const year = date.getFullYear();
	const progressRecords = await findProgressByChild(childId, year, tenantId);

	const progressMap = new Map<string, TenantEventProgress>();
	for (const p of progressRecords) {
		progressMap.set(p.eventCode, p);
	}

	const results: CalendarEventProgressInfo[] = [];

	for (const eventWithStatus of activeEventsWithStatus) {
		if (!eventWithStatus.enabled) continue;

		const def = eventWithStatus.definition;
		const progress = progressMap.get(def.id);

		// Sum up all mission targets for a simplified total target
		const totalTarget = def.defaultMissions.reduce((sum, m) => sum + m.targetCount, 0);
		const missionDesc = def.defaultMissions.map((m) => m.description).join(' / ');

		results.push({
			eventCode: def.id,
			eventName: def.name,
			eventIcon: def.icon,
			missionDescription: missionDesc,
			targetCount: totalTarget,
			currentCount: progress?.currentCount ?? 0,
			completed: progress?.completedAt != null,
			completedAt: progress?.completedAt ?? null,
			rewardMemo: eventWithStatus.rewardMemo,
		});
	}

	return results;
}

/**
 * Increment event progress when an activity is recorded.
 * Checks if the activity's category matches any active event mission.
 * Returns list of events where progress was incremented.
 */
export async function incrementEventProgress(
	childId: number,
	categoryId: number,
	tenantId: string,
	date: Date = new Date(),
): Promise<{ eventCode: string; eventName: string; completed: boolean }[]> {
	const activeEventsWithStatus = await getActiveCalendarEvents(tenantId, date);
	const year = date.getFullYear();
	const results: { eventCode: string; eventName: string; completed: boolean }[] = [];

	for (const eventWithStatus of activeEventsWithStatus) {
		if (!eventWithStatus.enabled) continue;

		const def = eventWithStatus.definition;

		// Check if any mission in this event targets the category
		const matchingMissions = def.defaultMissions.filter((m) => m.categoryId === categoryId);
		if (matchingMissions.length === 0) continue;

		// Get or create progress
		const existing = await findProgress(tenantId, def.id, childId, year);
		if (existing?.completedAt) continue; // Already completed

		const newCount = (existing?.currentCount ?? 0) + 1;
		const totalTarget = def.defaultMissions.reduce((sum, m) => sum + m.targetCount, 0);
		const completed = newCount >= totalTarget;

		await upsertProgress(
			{
				eventCode: def.id,
				childId,
				year,
				currentCount: newCount,
				completedAt: completed ? new Date().toISOString() : null,
			},
			tenantId,
		);

		if (completed) {
			logger.info('[calendar-event] Event completed by child', {
				context: { childId, eventCode: def.id, year },
			});
		}

		results.push({
			eventCode: def.id,
			eventName: def.name,
			completed,
		});
	}

	return results;
}

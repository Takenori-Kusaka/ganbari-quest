// src/lib/server/services/analytics-service.ts
// Analytics service — server-side event tracking facade.
// Wraps the analytics module with app-specific business event helpers.

import { analytics } from '$lib/analytics';
import type { BusinessEventName, EventProperties } from '$lib/analytics/types';

/**
 * Track a business event with standard metadata.
 */
export function trackBusinessEvent(
	eventName: BusinessEventName | string,
	properties?: EventProperties,
	tenantId?: string,
): void {
	if (tenantId) {
		analytics.identify(tenantId);
	}
	analytics.trackEvent(eventName, {
		...properties,
		tenantId,
	});
}

/**
 * Track an activity recording event.
 */
export function trackActivityRecorded(
	tenantId: string,
	childId: number,
	activityId: number,
	points: number,
	isMainQuest: boolean,
): void {
	trackBusinessEvent('activity_recorded', { childId, activityId, points, isMainQuest }, tenantId);
}

/**
 * Track a checklist completion event.
 */
export function trackChecklistCompleted(
	tenantId: string,
	childId: number,
	templateId: number,
	durationSeconds?: number,
): void {
	trackBusinessEvent('checklist_completed', { childId, templateId, durationSeconds }, tenantId);
}

/**
 * Track a stamp collection event.
 */
export function trackStampCollected(
	tenantId: string,
	childId: number,
	stampId: number,
	rarity: string,
): void {
	trackBusinessEvent('stamp_collected', { childId, stampId, rarity }, tenantId);
}

/**
 * Track a level up event.
 */
export function trackLevelUp(
	tenantId: string,
	childId: number,
	oldLevel: number,
	newLevel: number,
	categoryId?: number,
): void {
	trackBusinessEvent('level_up', { childId, oldLevel, newLevel, categoryId }, tenantId);
}

/**
 * Track a tutorial step event.
 */
export function trackTutorialStep(
	tenantId: string,
	step: number,
	action: 'advance' | 'skip' | 'complete',
): void {
	trackBusinessEvent('tutorial_step', { step, action }, tenantId);
}

/**
 * Track a child switch event.
 */
export function trackChildSwitch(
	tenantId: string,
	fromChildId: number | null,
	toChildId: number,
): void {
	trackBusinessEvent('child_switch', { fromChildId, toChildId }, tenantId);
}

/**
 * Track a server-side error for analytics correlation.
 */
export function trackServerError(
	error: Error,
	context?: {
		method?: string;
		path?: string;
		status?: number;
		requestId?: string;
		tenantId?: string;
	},
): void {
	analytics.trackError(error, context);
}

/**
 * Get analytics system status (for admin/ops dashboard).
 */
export function getAnalyticsStatus(): {
	providers: string[];
	umamiConfig: { websiteId: string; hostUrl: string } | null;
} {
	return {
		providers: analytics.getActiveProviders(),
		umamiConfig: analytics.getUmamiConfig(),
	};
}

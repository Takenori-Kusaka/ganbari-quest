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

// ── Activation Funnel (#831) ──────────────────────────────────

/**
 * Track: サインアップ + consent 完了 (Step 1)
 */
export function trackActivationSignupCompleted(tenantId: string): void {
	trackBusinessEvent('activation_signup_completed', { step: 1 }, tenantId);
}

/**
 * Track: テナント初の子供登録 (Step 2)
 * 呼び出し側で「初回かどうか」を判定すること。
 */
export function trackActivationFirstChildAdded(tenantId: string, childId: number): void {
	trackBusinessEvent('activation_first_child_added', { step: 2, childId }, tenantId);
}

/**
 * Track: テナント初の活動記録完了 (Step 3)
 * 呼び出し側で「初回かどうか」を判定すること。
 *
 * 子供単位の初回判定（activeCount === 1）。
 * テナント単位の初回判定は集計層で dedup する設計。
 */
export function trackActivationFirstActivityCompleted(
	tenantId: string,
	childId: number,
	activityId: number,
): void {
	trackBusinessEvent(
		'activation_first_activity_completed',
		{ step: 3, childId, activityId },
		tenantId,
	);
}

/**
 * Track: テナント初の報酬演出表示 (Step 4)
 * シール獲得またはレベルアップモーダル表示時。
 *
 * NOTE: Step 2/3 とは異なり、このイベントは報酬発生のたびに毎回発火する。
 * アプリ層での「初回判定」には追加 DB クエリが必要で、イベント頻度（スタンプ・レベルアップ）が
 * 低いため、テナント初回の判定は集計層（DynamoDB / BI）で dedup する設計とする。
 */
export function trackActivationFirstRewardSeen(
	tenantId: string,
	rewardType: 'stamp' | 'level_up',
): void {
	trackBusinessEvent('activation_first_reward_seen', { step: 4, rewardType }, tenantId);
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

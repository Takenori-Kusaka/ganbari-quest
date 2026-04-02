// src/lib/server/services/season-event-service.ts
// シーズンイベント管理サービス

import {
	findActiveEvents,
	findAllEvents,
	findChildProgress,
	findEventByCode,
	findEventById,
	insertEvent,
	claimReward as repoClaimReward,
	updateEvent,
	upsertChildProgress,
} from '$lib/server/db/season-event-repo';
import type {
	InsertSeasonEventInput,
	SeasonEvent,
	SeasonEventWithProgress,
	UpdateSeasonEventInput,
} from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

/** 全イベント一覧（管理画面用） */
export async function getAllEvents(tenantId: string): Promise<SeasonEvent[]> {
	return findAllEvents(tenantId);
}

/** 現在開催中のイベント一覧 */
export async function getActiveEvents(tenantId: string): Promise<SeasonEvent[]> {
	const today = new Date().toISOString().slice(0, 10);
	return findActiveEvents(today, tenantId);
}

/** 子供向け: 開催中イベント + 参加状況 */
export async function getActiveEventsForChild(
	childId: number,
	tenantId: string,
): Promise<SeasonEventWithProgress[]> {
	const today = new Date().toISOString().slice(0, 10);
	const events = await findActiveEvents(today, tenantId);

	const result: SeasonEventWithProgress[] = [];
	for (const event of events) {
		const progress = await findChildProgress(childId, event.id, tenantId);
		result.push({ ...event, progress: progress ?? null });
	}
	return result;
}

/** イベント参加（自動参加） */
export async function joinEvent(childId: number, eventId: number, tenantId: string): Promise<void> {
	const existing = await findChildProgress(childId, eventId, tenantId);
	if (!existing) {
		await upsertChildProgress(childId, eventId, 'active', null, tenantId);
		logger.info('[season-event] Child joined event', { context: { childId, eventId } });
	}
}

/** イベント進捗更新 */
export async function updateProgress(
	childId: number,
	eventId: number,
	progressJson: string,
	tenantId: string,
): Promise<void> {
	await upsertChildProgress(childId, eventId, 'active', progressJson, tenantId);
}

/** イベント報酬受取 */
export async function claimEventReward(
	childId: number,
	eventId: number,
	tenantId: string,
): Promise<{ rewardConfig: string | null }> {
	const event = await findEventById(eventId, tenantId);
	if (!event) throw new Error('Event not found');

	const progress = await findChildProgress(childId, eventId, tenantId);
	if (!progress) throw new Error('Not joined');
	if (progress.status === 'reward_claimed') throw new Error('Already claimed');

	await repoClaimReward(childId, eventId, tenantId);
	logger.info('[season-event] Reward claimed', { context: { childId, eventId } });

	return { rewardConfig: event.rewardConfig };
}

/** 活動記録時のイベントミッション進捗チェック */
export async function checkEventMissionProgress(
	childId: number,
	tenantId: string,
): Promise<{ eventId: number; missionComplete: boolean; eventName: string }[]> {
	const today = new Date().toISOString().slice(0, 10);
	const events = await findActiveEvents(today, tenantId);
	const results: { eventId: number; missionComplete: boolean; eventName: string }[] = [];

	for (const event of events) {
		if (!event.missionConfig) continue;

		let config: { type?: string; target?: number };
		try {
			config = JSON.parse(event.missionConfig);
		} catch {
			continue;
		}

		if (config.type !== 'total_records' || !config.target) continue;

		// 自動参加
		let progress = await findChildProgress(childId, event.id, tenantId);
		if (!progress) {
			await upsertChildProgress(childId, event.id, 'active', null, tenantId);
			progress = await findChildProgress(childId, event.id, tenantId);
		}
		if (!progress || progress.status === 'completed' || progress.status === 'reward_claimed')
			continue;

		// 進捗カウンタ更新
		let current = 0;
		if (progress.progressJson) {
			try {
				current = JSON.parse(progress.progressJson).count ?? 0;
			} catch {
				/* ignore */
			}
		}
		current++;

		const missionComplete = current >= config.target;
		const newStatus = missionComplete ? 'completed' : 'active';
		await upsertChildProgress(
			childId,
			event.id,
			newStatus,
			JSON.stringify({ count: current, target: config.target }),
			tenantId,
		);

		if (missionComplete) {
			logger.info('[season-event] Event mission completed', {
				context: { childId, eventId: event.id },
			});
		}

		results.push({ eventId: event.id, missionComplete, eventName: event.name });
	}

	return results;
}

/** 管理: イベント作成 */
export async function createEvent(
	input: InsertSeasonEventInput,
	tenantId: string,
): Promise<SeasonEvent> {
	const existing = await findEventByCode(input.code, tenantId);
	if (existing) throw new Error(`Event code "${input.code}" already exists`);
	return insertEvent(input, tenantId);
}

/** 管理: イベント更新 */
export async function editEvent(
	id: number,
	input: UpdateSeasonEventInput,
	tenantId: string,
): Promise<void> {
	return updateEvent(id, input, tenantId);
}

// src/lib/server/services/seasonal-content-service.ts
// 季節コンテンツ管理サービス — シーズンパス + 月替わり有料プラン報酬

import {
	findActiveEvents,
	findChildProgress,
	upsertChildProgress,
} from '$lib/server/db/season-event-repo';
import type { SeasonEvent } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

// ============================================================
// Types
// ============================================================

export interface SeasonPassMilestone {
	target: number;
	track: 'free' | 'premium';
	reward: {
		type: 'points' | 'title' | 'badge' | 'stamp' | 'theme';
		value?: number;
		name?: string;
		icon?: string;
		description?: string;
	};
}

export interface SeasonPassConfig {
	type: 'season_pass';
	milestones: SeasonPassMilestone[];
}

export interface SeasonPassProgress {
	count: number;
	claimedMilestones: { target: number; track: string }[];
}

export interface SeasonPassData {
	event: SeasonEvent;
	progress: SeasonPassProgress;
	milestones: (SeasonPassMilestone & {
		achieved: boolean;
		claimed: boolean;
		current: number;
	})[];
	remainingDays: number;
}

/** 管理画面向けの軽量シーズンパスサマリー（ペイロード削減） */
export interface SeasonPassSummary {
	eventName: string;
	bannerIcon: string;
	progress: SeasonPassProgress;
	milestones: SeasonPassData['milestones'];
	remainingDays: number;
}

export interface MonthlyRewardConfig {
	type: 'monthly_premium_reward';
	rewardType: 'title' | 'badge' | 'bonus_points';
	name: string;
	icon: string;
	description: string;
	value?: number; // points for bonus_points type
}

export interface MonthlyRewardData {
	event: SeasonEvent;
	config: MonthlyRewardConfig;
	claimed: boolean;
}

// ============================================================
// Season Pass
// ============================================================

function parseSeasonPassConfig(missionConfig: string | null): SeasonPassConfig | null {
	if (!missionConfig) return null;
	try {
		const config = JSON.parse(missionConfig);
		if (config.type !== 'season_pass' || !Array.isArray(config.milestones)) return null;
		return config as SeasonPassConfig;
	} catch {
		return null;
	}
}

function parseSeasonPassProgress(progressJson: string | null): SeasonPassProgress {
	if (!progressJson) return { count: 0, claimedMilestones: [] };
	try {
		const p = JSON.parse(progressJson);
		return {
			count: p.count ?? 0,
			claimedMilestones: Array.isArray(p.claimedMilestones) ? p.claimedMilestones : [],
		};
	} catch {
		return { count: 0, claimedMilestones: [] };
	}
}

/**
 * シーズンパスの進捗を読み取り専用で取得する内部ヘルパー。
 * passEvent を外部から受け取ることで N+1 の findActiveEvents 呼び出しを回避する。
 * readOnly=true のとき auto-join（upsertChildProgress）をスキップする。
 */
async function resolveSeasonPass(
	childId: number,
	passEvent: SeasonEvent,
	tenantId: string,
	isPremium: boolean,
	readOnly: boolean,
): Promise<SeasonPassData | null> {
	const config = parseSeasonPassConfig(passEvent.missionConfig);
	if (!config) return null;

	let progressRow = await findChildProgress(childId, passEvent.id, tenantId);

	if (!progressRow && !readOnly) {
		// Auto-join (write path only)
		await upsertChildProgress(childId, passEvent.id, 'active', null, tenantId);
		progressRow = await findChildProgress(childId, passEvent.id, tenantId);
	}

	const progress = parseSeasonPassProgress(progressRow?.progressJson ?? null);

	// Filter milestones by access level
	const accessibleMilestones = config.milestones.filter((m) => m.track === 'free' || isPremium);

	const milestones = accessibleMilestones.map((m) => ({
		...m,
		achieved: progress.count >= m.target,
		claimed: progress.claimedMilestones.some((c) => c.target === m.target && c.track === m.track),
		current: Math.min(progress.count, m.target),
	}));

	const endDate = new Date(`${passEvent.endDate}T23:59:59`);
	const remainingDays = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000));

	return { event: passEvent, progress, milestones, remainingDays };
}

/** 現在のシーズンパスを取得（子供向け — auto-join あり） */
export async function getSeasonPassForChild(
	childId: number,
	tenantId: string,
	isPremium: boolean,
): Promise<SeasonPassData | null> {
	const today = new Date().toISOString().slice(0, 10);
	const events = await findActiveEvents(today, tenantId);
	const passEvent = events.find((e) => e.eventType === 'season_pass');
	if (!passEvent) return null;

	return resolveSeasonPass(childId, passEvent, tenantId, isPremium, false);
}

/**
 * 読み取り専用でシーズンパス進捗を取得（管理画面用）。
 * auto-join をスキップするため、閲覧だけで参加レコードが作られない。
 * passEvent を外部から渡すことで findActiveEvents の N+1 呼び出しを回避する。
 */
export async function getSeasonPassForChildReadOnly(
	childId: number,
	passEvent: SeasonEvent,
	tenantId: string,
	isPremium: boolean,
): Promise<SeasonPassData | null> {
	return resolveSeasonPass(childId, passEvent, tenantId, isPremium, true);
}

/** シーズンパスのマイルストーン報酬を受け取る */
export async function claimSeasonPassMilestone(
	childId: number,
	eventId: number,
	target: number,
	track: string,
	tenantId: string,
): Promise<SeasonPassMilestone['reward'] | null> {
	const progressRow = await findChildProgress(childId, eventId, tenantId);
	if (!progressRow) return null;

	const progress = parseSeasonPassProgress(progressRow.progressJson);

	// Check already claimed
	if (progress.claimedMilestones.some((c) => c.target === target && c.track === track)) {
		return null;
	}

	// Check achieved
	if (progress.count < target) return null;

	// Find the milestone reward
	const events = await findActiveEvents(new Date().toISOString().slice(0, 10), tenantId);
	const passEvent = events.find((e) => e.id === eventId);
	if (!passEvent) return null;

	const config = parseSeasonPassConfig(passEvent.missionConfig);
	if (!config) return null;

	const milestone = config.milestones.find((m) => m.target === target && m.track === track);
	if (!milestone) return null;

	// Mark as claimed
	progress.claimedMilestones.push({ target, track });
	await upsertChildProgress(
		childId,
		eventId,
		progressRow.status,
		JSON.stringify(progress),
		tenantId,
	);

	logger.info('[seasonal] Season pass milestone claimed', {
		context: { childId, eventId, target, track },
	});

	return milestone.reward;
}

/** 活動記録時のシーズンパス進捗更新（activity-log-serviceから呼ばれる） */
export async function incrementSeasonPassProgress(
	childId: number,
	tenantId: string,
): Promise<{ eventId: number; newCount: number; newMilestones: SeasonPassMilestone[] } | null> {
	const today = new Date().toISOString().slice(0, 10);
	const events = await findActiveEvents(today, tenantId);
	const passEvent = events.find((e) => e.eventType === 'season_pass');
	if (!passEvent) return null;

	const config = parseSeasonPassConfig(passEvent.missionConfig);
	if (!config) return null;

	// Auto-join
	let progressRow = await findChildProgress(childId, passEvent.id, tenantId);
	if (!progressRow) {
		await upsertChildProgress(childId, passEvent.id, 'active', null, tenantId);
		progressRow = await findChildProgress(childId, passEvent.id, tenantId);
	}
	if (!progressRow) return null;

	const progress = parseSeasonPassProgress(progressRow.progressJson);
	const oldCount = progress.count;
	progress.count++;

	await upsertChildProgress(childId, passEvent.id, 'active', JSON.stringify(progress), tenantId);

	// Check newly achieved milestones
	const newMilestones = config.milestones.filter(
		(m) => m.target > oldCount && m.target <= progress.count,
	);

	return { eventId: passEvent.id, newCount: progress.count, newMilestones };
}

// ============================================================
// Monthly Premium Rewards
// ============================================================

function parseMonthlyRewardConfig(rewardConfig: string | null): MonthlyRewardConfig | null {
	if (!rewardConfig) return null;
	try {
		const config = JSON.parse(rewardConfig);
		if (config.type !== 'monthly_premium_reward') return null;
		return config as MonthlyRewardConfig;
	} catch {
		return null;
	}
}

/** 今月の有料プラン報酬を取得 */
export async function getMonthlyPremiumReward(
	childId: number,
	tenantId: string,
	isPremium: boolean,
): Promise<MonthlyRewardData | null> {
	if (!isPremium) return null;

	const today = new Date().toISOString().slice(0, 10);
	const events = await findActiveEvents(today, tenantId);
	const rewardEvent = events.find((e) => e.eventType === 'monthly_premium_reward');
	if (!rewardEvent) return null;

	const config = parseMonthlyRewardConfig(rewardEvent.rewardConfig);
	if (!config) return null;

	const progress = await findChildProgress(childId, rewardEvent.id, tenantId);
	const claimed = progress?.status === 'reward_claimed';

	return { event: rewardEvent, config, claimed };
}

/** 月替わり有料プラン報酬を受け取る */
export async function claimMonthlyPremiumReward(
	childId: number,
	eventId: number,
	tenantId: string,
	isPremium: boolean,
): Promise<MonthlyRewardConfig | null> {
	if (!isPremium) return null;

	const progressRow = await findChildProgress(childId, eventId, tenantId);

	// Already claimed
	if (progressRow?.status === 'reward_claimed') return null;

	// Find the event
	const today = new Date().toISOString().slice(0, 10);
	const events = await findActiveEvents(today, tenantId);
	const rewardEvent = events.find((e) => e.id === eventId);
	if (!rewardEvent) return null;

	const config = parseMonthlyRewardConfig(rewardEvent.rewardConfig);
	if (!config) return null;

	// Auto-join + claim
	await upsertChildProgress(
		childId,
		eventId,
		'reward_claimed',
		JSON.stringify({ claimedAt: new Date().toISOString() }),
		tenantId,
	);

	logger.info('[seasonal] Monthly premium reward claimed', {
		context: { childId, eventId, month: rewardEvent.code },
	});

	return config;
}

// ============================================================
// Memory Ticket (Loyalty Reward)
// ============================================================

export interface MemoryTicketStatus {
	totalMonths: number;
	ticketsEarned: number;
	ticketsUsed: number;
	ticketsAvailable: number;
	nextTicketAt: number; // months until next ticket
}

/** 思い出チケットの状態を取得（簡易版: settings KVで管理） */
export async function getMemoryTicketStatus(
	_tenantId: string,
	subscriptionStartDate: string | null,
): Promise<MemoryTicketStatus> {
	if (!subscriptionStartDate) {
		return {
			totalMonths: 0,
			ticketsEarned: 0,
			ticketsUsed: 0,
			ticketsAvailable: 0,
			nextTicketAt: 6,
		};
	}

	const start = new Date(subscriptionStartDate);
	const now = new Date();
	const totalMonths = Math.max(
		0,
		(now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()),
	);

	const ticketsEarned = Math.floor(totalMonths / 6);

	// ticketsUsed would be tracked in settings KV — simplified for now
	const ticketsUsed = 0;
	const ticketsAvailable = ticketsEarned - ticketsUsed;
	const nextTicketAt = 6 - (totalMonths % 6);

	return { totalMonths, ticketsEarned, ticketsUsed, ticketsAvailable, nextTicketAt };
}

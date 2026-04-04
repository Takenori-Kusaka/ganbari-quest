// src/lib/server/services/auto-challenge-service.ts
// Auto-Challenge Proposal Service
// Analyzes past activity records and generates weekly challenges
// targeting the child's weakest category.

import {
	expireOldChallenges,
	findActiveByChild,
	findByChild,
	findByChildAndWeek,
	insert,
	update,
} from '$lib/server/db/auto-challenge-repo';
import type { AutoChallenge } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

/** Category IDs from the categories master table */
const ALL_CATEGORY_IDS = [1, 2, 3, 4, 5];

/** Category names for display */
const CATEGORY_NAMES: Record<number, string> = {
	1: 'うんどう',
	2: 'べんきょう',
	3: 'せいかつ',
	4: 'こうりゅう',
	5: 'そうぞう',
};

/** Default target count for weekly challenges */
const DEFAULT_TARGET_COUNT = 3;

/** Minimum records to analyze (if below this, use default challenge) */
const MIN_RECORDS_FOR_ANALYSIS = 3;

export interface AutoChallengeProposal {
	categoryId: number;
	categoryName: string;
	targetCount: number;
	reason: string;
}

export interface ActiveChallengeInfo {
	id: number;
	categoryId: number;
	categoryName: string;
	targetCount: number;
	currentCount: number;
	weekStart: string;
	status: string;
	progressPercent: number;
	description: string;
}

/**
 * Get the current Monday's date string (YYYY-MM-DD) for a given date.
 * Uses local date components to avoid timezone issues.
 */
export function getWeekStart(date: Date = new Date()): string {
	const d = new Date(date);
	const day = d.getDay(); // 0=Sun, 1=Mon, ...
	const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
	d.setDate(d.getDate() + diff);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Analyze a child's past activity records and identify the weakest category.
 * Returns category counts from the past 2 weeks of activity_logs.
 */
export async function analyzeWeakCategory(
	childId: number,
	tenantId: string,
): Promise<AutoChallengeProposal> {
	// Dynamically import to avoid circular dependency
	const { getActivityLogs } = await import('$lib/server/services/activity-log-service');

	const now = new Date();
	const twoWeeksAgo = new Date(now);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

	const fromDate = twoWeeksAgo.toISOString().slice(0, 10);
	const toDate = now.toISOString().slice(0, 10);

	const { summary } = await getActivityLogs(childId, tenantId, {
		from: fromDate,
		to: toDate,
	});

	// Count per category
	const categoryCounts: Record<number, number> = {};
	for (const catId of ALL_CATEGORY_IDS) {
		categoryCounts[catId] = summary.byCategory[catId]?.count ?? 0;
	}

	const totalRecords = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

	// If not enough data, suggest a random category
	if (totalRecords < MIN_RECORDS_FOR_ANALYSIS) {
		const randomCatId = ALL_CATEGORY_IDS[Math.floor(Math.random() * ALL_CATEGORY_IDS.length)] ?? 1;
		return {
			categoryId: randomCatId,
			categoryName: CATEGORY_NAMES[randomCatId] ?? '',
			targetCount: DEFAULT_TARGET_COUNT,
			reason: 'まだ記録が少ないので、いろんなことにチャレンジしてみよう！',
		};
	}

	// Find the weakest category (fewest records)
	let weakestCatId = ALL_CATEGORY_IDS[0] ?? 1;
	let minCount = Number.MAX_SAFE_INTEGER;

	for (const catId of ALL_CATEGORY_IDS) {
		const count = categoryCounts[catId] ?? 0;
		if (count < minCount) {
			minCount = count;
			weakestCatId = catId;
		}
	}

	// Calculate a reasonable target: slightly above recent average for this category
	// but not too high — we want achievable challenges
	const avgPerWeek = Math.max(1, Math.ceil(minCount / 2)); // Average over 2 weeks
	const targetCount = Math.max(DEFAULT_TARGET_COUNT, avgPerWeek + 1);

	const catName = CATEGORY_NAMES[weakestCatId] ?? '';

	return {
		categoryId: weakestCatId,
		categoryName: catName,
		targetCount: Math.min(targetCount, 7), // Cap at 7 per week
		reason: `最近「${catName}」が少なめだったから、今週はチャレンジしてみよう！`,
	};
}

/**
 * Generate (or get existing) weekly auto-challenge for a child.
 * Called when the child opens the app / at week start.
 */
export async function getOrCreateWeeklyChallenge(
	childId: number,
	tenantId: string,
): Promise<ActiveChallengeInfo | null> {
	const weekStart = getWeekStart();

	// Check if challenge already exists for this week
	const existing = await findByChildAndWeek(childId, weekStart, tenantId);
	if (existing) {
		return formatChallengeInfo(existing);
	}

	// Expire old active challenges
	await expireOldChallenges(weekStart, tenantId);

	// Generate new proposal
	const proposal = await analyzeWeakCategory(childId, tenantId);

	// Insert new challenge
	const challenge = await insert(
		{
			childId,
			weekStart,
			categoryId: proposal.categoryId,
			targetCount: proposal.targetCount,
		},
		tenantId,
	);

	logger.info('[auto-challenge] Generated weekly challenge', {
		context: {
			childId,
			weekStart,
			categoryId: proposal.categoryId,
			targetCount: proposal.targetCount,
			reason: proposal.reason,
		},
	});

	return formatChallengeInfo(challenge);
}

/**
 * Get the active auto-challenge for a child (if any).
 */
export async function getActiveChallenge(
	childId: number,
	tenantId: string,
): Promise<ActiveChallengeInfo | null> {
	const challenge = await findActiveByChild(childId, tenantId);
	if (!challenge) return null;
	return formatChallengeInfo(challenge);
}

/**
 * Get challenge history for a child.
 */
export async function getChallengeHistory(
	childId: number,
	tenantId: string,
	limit = 10,
): Promise<ActiveChallengeInfo[]> {
	const challenges = await findByChild(childId, tenantId, limit);
	return challenges.map(formatChallengeInfo);
}

/**
 * Increment auto-challenge progress when an activity in the matching category is recorded.
 * Returns whether the challenge was completed by this increment.
 */
export async function incrementChallengeProgress(
	childId: number,
	categoryId: number,
	tenantId: string,
): Promise<{ challengeCompleted: boolean; challengeInfo: ActiveChallengeInfo | null }> {
	const challenge = await findActiveByChild(childId, tenantId);
	if (!challenge || challenge.categoryId !== categoryId) {
		return { challengeCompleted: false, challengeInfo: null };
	}

	const newCount = challenge.currentCount + 1;
	const completed = newCount >= challenge.targetCount;

	await update(
		challenge.id,
		{
			currentCount: newCount,
			status: completed ? 'completed' : 'active',
		},
		tenantId,
	);

	if (completed) {
		logger.info('[auto-challenge] Challenge completed!', {
			context: { childId, challengeId: challenge.id },
		});
	}

	const updatedChallenge: AutoChallenge = {
		...challenge,
		currentCount: newCount,
		status: completed ? 'completed' : 'active',
	};

	return {
		challengeCompleted: completed,
		challengeInfo: formatChallengeInfo(updatedChallenge),
	};
}

/**
 * Format a DB record into a UI-friendly info object.
 */
function formatChallengeInfo(challenge: AutoChallenge): ActiveChallengeInfo {
	const catName = CATEGORY_NAMES[challenge.categoryId] ?? '';
	const progressPercent = Math.min(
		100,
		Math.round((challenge.currentCount / challenge.targetCount) * 100),
	);

	return {
		id: challenge.id,
		categoryId: challenge.categoryId,
		categoryName: catName,
		targetCount: challenge.targetCount,
		currentCount: challenge.currentCount,
		weekStart: challenge.weekStart,
		status: challenge.status,
		progressPercent,
		description: `今週は「${catName}」を${challenge.targetCount}回やってみよう！`,
	};
}

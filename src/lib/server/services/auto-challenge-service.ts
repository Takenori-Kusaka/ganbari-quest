// src/lib/server/services/auto-challenge-service.ts
// Auto-Challenge Proposal Service (#3194)
// 苦手中心＋時々得意の週次チャレンジを、行動科学・教育心理学ベースの
// ヒューリスティック＋調整可能定数で生成する。
// 設計: docs/design/44-チャレンジ設計書.md §3.4 / docs/rationale/12-auto-challenge-generation-rationale.md

import {
	expireOldChallenges,
	findActiveByChild,
	findByChild,
	findByChildAndWeek,
	insert,
	update,
} from '$lib/server/db/auto-challenge-repo';
import type { AutoChallenge, AutoChallengeMode } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { aggregateActivityLogsByCategory } from '$lib/server/services/activity-log-aggregation';

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

// ============================================================
// 調整可能定数 (§3.4)。1 箇所に集約し「ルールエンジン化しない」境界を物理的に示す。
// ============================================================
/** 実測週平均 + これ = base target */
const TARGET_DELTA = 1;
/** target 下限 (Fogg "make it tiny" で 3→2)。週1回ペースを下回らせない最小の前進 */
const MIN_TARGET = 2;
/** target 上限 (青天井で難度を煽らない) */
const MAX_TARGET = 7;
/** 苦手カテゴリ優先の重み (rank 0 の苦手に WEAK_BIAS_BASE、以降 -1) */
const WEAK_BIAS_BASE = 5;
/** 「得意深掘り週」を入れる周期 */
const EVERY_N_WEEKS_STRONG = 4;
/** 達成時の昇圧 (ジャスト達成) */
const BUMP_NORMAL = 1;
/** 達成時の昇圧 (大幅超過) */
const BUMP_OVERSHOOT = 2;
/** 連続未達がこの数に達したらレスキュー (target 最小 + 得意週) に切替える */
const MISS_RESCUE_AFTER = 2;
/** Minimum records to analyze (if below this, use explore challenge) */
const MIN_RECORDS_FOR_ANALYSIS = 3;

export interface AutoChallengeProposal {
	categoryId: number;
	categoryName: string;
	targetCount: number;
	mode: AutoChallengeMode;
	consecutiveMissCount: number;
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
	mode: string;
	progressPercent: number;
	description: string;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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

/** weekStart (YYYY-MM-DD, Monday) の 1 週間前の Monday を返す。 */
export function getLastWeekStart(weekStart: string): string {
	const [y, m, d] = weekStart.split('-').map(Number);
	const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
	dt.setUTCDate(dt.getUTCDate() - 7);
	const yyyy = dt.getUTCFullYear();
	const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(dt.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** weekStart を epoch からの週インデックスに変換する (得意週の周期判定用、決定的)。 */
function weekIndexOf(weekStart: string): number {
	const [y, m, d] = weekStart.split('-').map(Number);
	const ms = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

/** 直近 2 週間のカテゴリ別記録数を集計する。child_challenges 生成側 (#3195) でも再利用する。 */
export async function aggregateCategoryCounts(
	childId: number,
	tenantId: string,
): Promise<Record<number, number>> {
	const now = new Date();
	const twoWeeksAgo = new Date(now);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
	const fromDate = twoWeeksAgo.toISOString().slice(0, 10);
	const toDate = now.toISOString().slice(0, 10);

	const { summary } = await aggregateActivityLogsByCategory(childId, tenantId, {
		from: fromDate,
		to: toDate,
	});

	const counts: Record<number, number> = {};
	for (const catId of ALL_CATEGORY_IDS) {
		counts[catId] = summary.byCategory[catId]?.count ?? 0;
	}
	return counts;
}

/** 最多記録カテゴリ (得意) を返す。同数は最小 id を優先 (決定的)。 */
function strongestCategory(counts: Record<number, number>): number {
	let best = ALL_CATEGORY_IDS[0] ?? 1;
	let max = -1;
	for (const catId of ALL_CATEGORY_IDS) {
		const n = counts[catId] ?? 0;
		if (n > max) {
			max = n;
			best = catId;
		}
	}
	return best;
}

/**
 * 苦手バイアスの重み付き抽選。記録が少ないカテゴリほど重みが高い (rank 0 = WEAK_BIAS_BASE)。
 * excludeId を渡すと連続週の同一カテゴリを避ける。
 */
function weightedWeakPick(counts: Record<number, number>, excludeId?: number): number {
	const cats = ALL_CATEGORY_IDS.filter((c) => c !== excludeId);
	const sorted = [...cats].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
	const weighted = sorted.map((c, rank) => ({ c, w: Math.max(1, WEAK_BIAS_BASE - rank) }));
	const total = weighted.reduce((s, x) => s + x.w, 0);
	let r = Math.random() * total;
	for (const x of weighted) {
		r -= x.w;
		if (r <= 0) return x.c;
	}
	return sorted[0] ?? ALL_CATEGORY_IDS[0] ?? 1;
}

function reasonFor(mode: AutoChallengeMode, categoryName: string): string {
	switch (mode) {
		case 'explore':
			return 'まだ記録が少ないので、いろんなことにチャレンジしてみよう！';
		case 'strength':
			return `得意な「${categoryName}」をもっと伸ばしてみよう！`;
		case 'rescue-strength':
			return `得意な「${categoryName}」でリズムを取り戻そう！`;
		default:
			return `最近「${categoryName}」が少なめだったから、今週はチャレンジしてみよう！`;
	}
}

/** カテゴリ選択 (weighted interleaving §3.4)。explore / rescue-strength / strength / weakness を返す。 */
function selectCategory(
	counts: Record<number, number>,
	prev: AutoChallenge | undefined,
	weekStart: string,
	consecutiveMissCount: number,
): { categoryId: number; mode: AutoChallengeMode } {
	const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
	if (totalRecords < MIN_RECORDS_FOR_ANALYSIS) {
		return {
			categoryId: ALL_CATEGORY_IDS[Math.floor(Math.random() * ALL_CATEGORY_IDS.length)] ?? 1,
			mode: 'explore',
		};
	}
	if (consecutiveMissCount >= MISS_RESCUE_AFTER) {
		return { categoryId: strongestCategory(counts), mode: 'rescue-strength' };
	}
	if (weekIndexOf(weekStart) % EVERY_N_WEEKS_STRONG === 0) {
		return { categoryId: strongestCategory(counts), mode: 'strength' };
	}
	let categoryId = weightedWeakPick(counts);
	// 直前週と同一カテゴリは原則回避 (interleaving の連続ブロック防止)
	if (prev != null && categoryId === prev.categoryId) {
		categoryId = weightedWeakPick(counts, prev.categoryId);
	}
	return { categoryId, mode: 'weakness' };
}

/** target 決定 (ability ベース + Flow 3 分岐適応 §3.4)。 */
function decideTarget(
	counts: Record<number, number>,
	prev: AutoChallenge | undefined,
	categoryId: number,
	mode: AutoChallengeMode,
): number {
	if (mode === 'rescue-strength') return MIN_TARGET; // 必ず達成できる最小目標

	const avg = (counts[categoryId] ?? 0) / 2; // 直近 2 週の週平均
	const base = clamp(Math.round(avg) + TARGET_DELTA, MIN_TARGET, MAX_TARGET);

	if (prev == null || prev.categoryId !== categoryId) return base; // 別カテゴリは base 基準
	if (prev.status === 'completed') {
		const overshoot = prev.currentCount - prev.targetCount;
		const bump = overshoot >= 2 ? BUMP_OVERSHOOT : BUMP_NORMAL;
		return clamp(Math.max(base, prev.targetCount + bump), MIN_TARGET, MAX_TARGET);
	}
	// 同カテゴリ未達: 半分以上できていれば据置 (折らない)、半分未満は下げる (anxiety 脱出)
	const ratio = prev.targetCount > 0 ? prev.currentCount / prev.targetCount : 0;
	return ratio >= 0.5
		? Math.max(MIN_TARGET, prev.targetCount)
		: Math.max(MIN_TARGET, prev.targetCount - 1);
}

/**
 * カテゴリ別記録数と前週チャレンジから今週のチャレンジ提案を決める (§3.4)。
 * カテゴリ選択 (weighted interleaving) + target (ability ベース + 前週結果の Flow 適応) を統合する。
 */
export function computeProposal(
	counts: Record<number, number>,
	prev: AutoChallenge | undefined,
	weekStart: string,
): AutoChallengeProposal {
	// 生成時点での「連続未達週数」(前週が未達なら前週の streak + 1、達成ならリセット)
	const prevMissed = prev != null && prev.status !== 'completed';
	const consecutiveMissCount = prevMissed ? (prev?.consecutiveMissCount ?? 0) + 1 : 0;

	const { categoryId, mode } = selectCategory(counts, prev, weekStart, consecutiveMissCount);
	const targetCount = decideTarget(counts, prev, categoryId, mode);

	const categoryName = CATEGORY_NAMES[categoryId] ?? '';
	return {
		categoryId,
		categoryName,
		targetCount,
		mode,
		consecutiveMissCount,
		reason: reasonFor(mode, categoryName),
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

	// 前週チャレンジを読んで翌週適応の入力にする (§3.4)
	const prev = await findByChildAndWeek(childId, getLastWeekStart(weekStart), tenantId);
	const counts = await aggregateCategoryCounts(childId, tenantId);
	const proposal = computeProposal(counts, prev, weekStart);

	// Insert new challenge
	const challenge = await insert(
		{
			childId,
			weekStart,
			categoryId: proposal.categoryId,
			targetCount: proposal.targetCount,
			mode: proposal.mode,
			consecutiveMissCount: proposal.consecutiveMissCount,
		},
		tenantId,
	);

	logger.info('[auto-challenge] Generated weekly challenge', {
		context: {
			childId,
			weekStart,
			categoryId: proposal.categoryId,
			targetCount: proposal.targetCount,
			mode: proposal.mode,
			consecutiveMissCount: proposal.consecutiveMissCount,
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

// ============================================================
// analytics (§3.4 フィードバック改善)。ユーザーカスタマイズを撤去したため、
// アルゴリズム改善の唯一の入力が達成率系の集計。既存 auto_challenges 行から算出する。
// ============================================================

export interface ChallengeAnalytics {
	/** 集計対象の生成週数 */
	totalWeeks: number;
	/** 全体の達成率 (completed / 全週) */
	completionRate: number;
	/** カテゴリ別達成率 (completed / そのカテゴリの生成数) */
	completionRateByCategory: Record<number, number>;
	/** 達成時の平均超過度 (currentCount - targetCount、completed のみ) */
	avgOvershoot: number;
	/** 未達時の平均到達率 (currentCount / targetCount、未達のみ) */
	avgReachRatioWhenMissed: number;
	/** 2 連続未達が発生した週の割合 (consecutiveMissCount >= 2) */
	consecutiveMissRate: number;
	/** 得意週 (strength/rescue-strength) の達成率 */
	strengthCompletionRate: number;
	/** 苦手週 (weakness) の達成率 */
	weaknessCompletionRate: number;
}

/**
 * auto_challenges 行のリストから達成率系 analytics を算出する純粋関数。
 * 親レポート / アルゴリズム定数チューニングの入力に使う (§3.4)。
 */
export function summarizeChallengeAnalytics(challenges: AutoChallenge[]): ChallengeAnalytics {
	const total = challenges.length;
	const isDone = (c: AutoChallenge) => c.status === 'completed';
	const rate = (subset: AutoChallenge[]) =>
		subset.length === 0 ? 0 : subset.filter(isDone).length / subset.length;

	const byCategory: Record<number, number> = {};
	for (const catId of ALL_CATEGORY_IDS) {
		byCategory[catId] = rate(challenges.filter((c) => c.categoryId === catId));
	}

	const completed = challenges.filter(isDone);
	const missed = challenges.filter((c) => c.status !== 'completed');
	const avgOvershoot =
		completed.length === 0
			? 0
			: completed.reduce((s, c) => s + (c.currentCount - c.targetCount), 0) / completed.length;
	const avgReachRatioWhenMissed =
		missed.length === 0
			? 0
			: missed.reduce((s, c) => s + (c.targetCount > 0 ? c.currentCount / c.targetCount : 0), 0) /
				missed.length;

	const strengthWeeks = challenges.filter(
		(c) => c.mode === 'strength' || c.mode === 'rescue-strength',
	);
	const weaknessWeeks = challenges.filter((c) => c.mode === 'weakness');

	return {
		totalWeeks: total,
		completionRate: rate(challenges),
		completionRateByCategory: byCategory,
		avgOvershoot,
		avgReachRatioWhenMissed,
		consecutiveMissRate:
			total === 0 ? 0 : challenges.filter((c) => c.consecutiveMissCount >= 2).length / total,
		strengthCompletionRate: rate(strengthWeeks),
		weaknessCompletionRate: rate(weaknessWeeks),
	};
}

/**
 * child の達成率 analytics を取得する。直近 weeks 週分を集計する。
 */
export async function getChallengeAnalytics(
	childId: number,
	tenantId: string,
	weeks = 26,
): Promise<ChallengeAnalytics> {
	const challenges = await findByChild(childId, tenantId, weeks);
	return summarizeChallengeAnalytics(challenges);
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
		mode: challenge.mode,
		progressPercent,
		description: `今週は「${catName}」を${challenge.targetCount}回やってみよう！`,
	};
}

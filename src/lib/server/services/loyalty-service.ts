// src/lib/server/services/loyalty-service.ts
// サブスク継続特典・ロイヤルティシステム

import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

// ============================================================
// Settings Keys
// ============================================================

const KEYS = {
	subscriptionMonths: 'loyalty_subscription_months',
	memoryTickets: 'loyalty_memory_tickets',
	lastIncrementMonth: 'loyalty_last_increment_month',
} as const;

// ============================================================
// Tier Definitions
// ============================================================

export interface LoyaltyTier {
	name: string;
	months: number;
	titleUnlock: string | null;
	loginBonusMultiplier: number;
	memoryTicketsAwarded: number; // cumulative tickets awarded at this tier
}

const TIERS: LoyaltyTier[] = [
	{
		name: 'はじめてのぼうけんしゃ',
		months: 1,
		titleUnlock: null,
		loginBonusMultiplier: 1.0,
		memoryTicketsAwarded: 0,
	},
	{
		name: 'きせつのたびびと',
		months: 3,
		titleUnlock: 'きせつのたびびと',
		loginBonusMultiplier: 1.2,
		memoryTicketsAwarded: 0,
	},
	{
		name: 'ベテランぼうけんしゃ',
		months: 6,
		titleUnlock: 'ベテランぼうけんしゃ',
		loginBonusMultiplier: 1.3,
		memoryTicketsAwarded: 1,
	},
	{
		name: 'でんせつのぼうけんしゃ',
		months: 12,
		titleUnlock: 'でんせつのぼうけんしゃ',
		loginBonusMultiplier: 1.5,
		memoryTicketsAwarded: 3,
	},
	{
		name: 'がんばりクエスト マスター',
		months: 24,
		titleUnlock: 'がんばりクエスト マスター',
		loginBonusMultiplier: 1.5,
		memoryTicketsAwarded: 6,
	},
];

// ============================================================
// Core Queries
// ============================================================

export async function getSubscriptionMonths(tenantId: string): Promise<number> {
	const val = await getSetting(KEYS.subscriptionMonths, tenantId);
	return val ? Number.parseInt(val, 10) : 0;
}

export async function getMemoryTickets(tenantId: string): Promise<number> {
	const val = await getSetting(KEYS.memoryTickets, tenantId);
	return val ? Number.parseInt(val, 10) : 0;
}

// ============================================================
// Tier Logic
// ============================================================

/** 現在のティアを取得 */
export function getCurrentTier(months: number): LoyaltyTier {
	let current = TIERS[0]!;
	for (const tier of TIERS) {
		if (months >= tier.months) {
			current = tier;
		}
	}
	return current;
}

/** 次のティアを取得 */
export function getNextTier(months: number): (LoyaltyTier & { remaining: number }) | null {
	const next = TIERS.find((t) => t.months > months);
	if (!next) return null;
	return { ...next, remaining: next.months - months };
}

/** ログインボーナス倍率を取得 */
export function getLoginBonusMultiplier(months: number): number {
	return getCurrentTier(months).loginBonusMultiplier;
}

/** 全ティアの解放状況を取得 */
export function getTierStatus(months: number): {
	tiers: (LoyaltyTier & { unlocked: boolean })[];
	currentTier: LoyaltyTier;
	nextTier: (LoyaltyTier & { remaining: number }) | null;
} {
	const tiers = TIERS.map((t) => ({ ...t, unlocked: months >= t.months }));
	return {
		tiers,
		currentTier: getCurrentTier(months),
		nextTier: getNextTier(months),
	};
}

// ============================================================
// Full Loyalty Info (for UI)
// ============================================================

export interface LoyaltyInfo {
	subscriptionMonths: number;
	memoryTickets: number;
	currentTier: LoyaltyTier;
	nextTier: (LoyaltyTier & { remaining: number }) | null;
	tiers: (LoyaltyTier & { unlocked: boolean })[];
	loginBonusMultiplier: number;
}

export async function getLoyaltyInfo(tenantId: string): Promise<LoyaltyInfo> {
	const subscriptionMonths = await getSubscriptionMonths(tenantId);
	const memoryTickets = await getMemoryTickets(tenantId);
	const { tiers, currentTier, nextTier } = getTierStatus(subscriptionMonths);

	return {
		subscriptionMonths,
		memoryTickets,
		currentTier,
		nextTier,
		tiers,
		loginBonusMultiplier: currentTier.loginBonusMultiplier,
	};
}

// ============================================================
// Mutation: Increment & Ticket Management
// ============================================================

/**
 * サブスク月次課金成功時に呼び出す。
 * subscriptionMonths をインクリメントし、ティア到達時に思い出チケットを付与。
 */
export async function incrementSubscriptionMonth(tenantId: string): Promise<{
	newMonths: number;
	tierUp: boolean;
	newTier: LoyaltyTier | null;
	ticketsAwarded: number;
}> {
	// 二重インクリメント防止
	const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
	const lastIncrement = await getSetting(KEYS.lastIncrementMonth, tenantId);
	if (lastIncrement === currentMonth) {
		const months = await getSubscriptionMonths(tenantId);
		return { newMonths: months, tierUp: false, newTier: null, ticketsAwarded: 0 };
	}

	const oldMonths = await getSubscriptionMonths(tenantId);
	const newMonths = oldMonths + 1;
	await setSetting(KEYS.subscriptionMonths, String(newMonths), tenantId);
	await setSetting(KEYS.lastIncrementMonth, currentMonth, tenantId);

	// ティア到達チェック
	const oldTier = getCurrentTier(oldMonths);
	const newTier = getCurrentTier(newMonths);
	const tierUp = newTier.months > oldTier.months;

	// 思い出チケット付与 (ティアの累計チケット数 - 現在保有チケット数を加算)
	let ticketsAwarded = 0;
	if (tierUp && newTier.memoryTicketsAwarded > oldTier.memoryTicketsAwarded) {
		ticketsAwarded = newTier.memoryTicketsAwarded - oldTier.memoryTicketsAwarded;
		const currentTickets = await getMemoryTickets(tenantId);
		await setSetting(KEYS.memoryTickets, String(currentTickets + ticketsAwarded), tenantId);
	}

	if (tierUp) {
		logger.info('[loyalty] Tier up', {
			context: { tenantId, newMonths, newTier: newTier.name, ticketsAwarded },
		});
	}

	return { newMonths, tierUp, newTier: tierUp ? newTier : null, ticketsAwarded };
}

/** 思い出チケットを消費（過去アイテム交換時） */
export async function consumeMemoryTicket(
	tenantId: string,
): Promise<{ success: boolean; remaining: number }> {
	const current = await getMemoryTickets(tenantId);
	if (current <= 0) {
		return { success: false, remaining: 0 };
	}
	const remaining = current - 1;
	await setSetting(KEYS.memoryTickets, String(remaining), tenantId);
	return { success: true, remaining };
}

/** 年額プラン購入時のボーナス適用 */
export async function applyAnnualPlanBonus(tenantId: string): Promise<{
	monthsSet: number;
	ticketsAwarded: number;
}> {
	const currentMonths = await getSubscriptionMonths(tenantId);
	// 年額は6ヶ月分として即座にカウント（現在値が6未満の場合のみ）
	const newMonths = Math.max(currentMonths, 6);
	await setSetting(KEYS.subscriptionMonths, String(newMonths), tenantId);

	// ボーナスチケット1枚
	const currentTickets = await getMemoryTickets(tenantId);
	await setSetting(KEYS.memoryTickets, String(currentTickets + 1), tenantId);

	// ティア更新
	const tier = getCurrentTier(newMonths);
	const ticketsFromTier = tier.memoryTicketsAwarded;
	// ティア分のチケットが不足していれば補填
	const totalExpected = ticketsFromTier + 1; // tier分 + ボーナス1枚
	const totalHave = currentTickets + 1;
	const extraNeeded = Math.max(0, totalExpected - totalHave);
	if (extraNeeded > 0) {
		await setSetting(KEYS.memoryTickets, String(totalHave + extraNeeded), tenantId);
	}

	logger.info('[loyalty] Annual plan bonus applied', {
		context: { tenantId, newMonths, ticketsAwarded: 1 + extraNeeded },
	});

	return { monthsSet: newMonths, ticketsAwarded: 1 + extraNeeded };
}

// ============================================================
// Churn Prevention Data
// ============================================================

export interface ChurnPreventionData {
	subscriptionMonths: number;
	currentTier: LoyaltyTier;
	memoryTickets: number;
	loginBonusMultiplier: number;
	lostItems: string[];
}

/** 解約防止モーダルに表示するデータを構築 */
export async function getChurnPreventionData(tenantId: string): Promise<ChurnPreventionData> {
	const months = await getSubscriptionMonths(tenantId);
	const tickets = await getMemoryTickets(tenantId);
	const tier = getCurrentTier(months);

	const lostItems: string[] = [];
	if (months > 0) lostItems.push(`月替わり限定アイテム ${months}個`);
	if (tickets > 0) lostItems.push(`思い出チケット ${tickets}枚`);
	if (tier.loginBonusMultiplier > 1.0)
		lostItems.push(`ログインボーナス ×${tier.loginBonusMultiplier}倍`);
	if (tier.titleUnlock) lostItems.push(`「${tier.titleUnlock}」称号`);
	lostItems.push('90日以前のデータへのアクセス');

	return {
		subscriptionMonths: months,
		currentTier: tier,
		memoryTickets: tickets,
		loginBonusMultiplier: tier.loginBonusMultiplier,
		lostItems,
	};
}

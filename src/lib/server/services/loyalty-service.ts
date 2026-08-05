// src/lib/server/services/loyalty-service.ts
// サブスク継続特典・ロイヤルティシステム

import { monthKeyJST, shiftMonthKey } from '$lib/domain/date-utils';
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
// 二重加算防止キーの基準 (#4127 AC7、PO 決裁 2026-08-03)
// ============================================================
//
// 保存値に **どの基準で出した月キーか** を含める。`2026-08` とだけ書かれていると
// 「JST の 8 月」なのか「UTC の 8 月 (JST では 9 月かもしれない)」なのかが
// **保存値だけでは分からず**、比較の是非を決められない。
//
// prefix を付ける方向にしか進まないので、時間が経つほど曖昧な値は減る。

/** JST 基準の月キーであることを示す prefix。 */
export const JST_MONTH_KEY_PREFIX = 'jst:';

/** `2026-08` → `jst:2026-08`。既に prefix 付きならそのまま返す。 */
export function toJstMonthKeyValue(monthKey: string): string {
	return monthKey.startsWith(JST_MONTH_KEY_PREFIX)
		? monthKey
		: `${JST_MONTH_KEY_PREFIX}${monthKey}`;
}

/**
 * 保存済みの値が「今の JST 月に加算済み」を意味するか。
 *
 * **prefix 無しの旧値 (UTC 基準の可能性がある) は一致とみなさない**。
 * 旧値は JST 月初 0:00〜09:00 に加算されていれば前月キーで保存されているため、
 * 「一致しない」= 加算する 側に倒すと **同じ JST 月に 2 回加算** されうる。
 * 逆に「一致とみなす」= skip 側に倒すと **正当な当月加算を落とす**。
 *
 * ここは **skip 側に倒す**。理由は誤りの回復可能性が非対称だから:
 *
 *   - 取りこぼし → 継続月数が 1 少ないだけで、次月の加算で追いつく。運用者が手で直せる
 *   - 過剰加算 → 未達のティア特典 (思い出チケット) を配ってしまい、**回収できない**
 *
 * 「配ってしまったものは取り返せない」ため、疑わしいときは配らない。
 * prefix 付きの値だけを厳密比較の対象にすれば、この曖昧さは新規保存分から消える。
 *
 * 曖昧なのは **当月リテラルと前月リテラルの 2 つ**である:
 *
 *   - 当月一致 (`2026-08` / `jst:2026-08`) — UTC 基準でも JST 基準でも今月を指す
 *   - 前月一致 (`2026-07` / `jst:2026-08`) — 正当な前月加算かもしれないし、
 *     JST 月初 0:00〜09:00 (UTC ではまだ前月) の加算が前月キーで保存された行かもしれない
 *
 * どちらも「今月加算済み」の可能性を否定できないので skip する。前々月以前は
 * JST/UTC の 9 時間差では説明できないため曖昧でなく、加算してよい。
 */
export function isSameJstMonth(stored: string | null | undefined, currentJstKey: string): boolean {
	if (!stored) return false;
	if (stored.startsWith(JST_MONTH_KEY_PREFIX)) return stored === currentJstKey;
	// 旧値 (基準不明)。当月・前月のいずれかを指しているなら加算済みの可能性があるので skip する。
	const currentMonthKey = currentJstKey.slice(JST_MONTH_KEY_PREFIX.length);
	return stored === currentMonthKey || stored === shiftMonthKey(currentMonthKey, -1);
}

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
	// biome-ignore lint/style/noNonNullAssertion: TIERS is a non-empty const array
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
	// 二重防止キーは JST 月キー。UTC 月キーだと JST 月初 0:00-9:00 に届いた webhook の
	// 月が前月として記録され、その月の加算がスキップされうる (常に顧客不利、#4127)。
	//
	// **保存値に基準を含める (#4127 AC7、PO 決裁 2026-08-03)**: 旧実装は UTC 月キーを
	// prefix 無しで保存していた。値が `2026-08` としか書かれていないと、それが
	// 「JST で 8 月に加算した」のか「UTC で 8 月と判定した (= JST では 9 月かもしれない)」のか
	// **保存値だけでは区別できない**。区別できないまま比較すると、どちらに倒しても片方が誤る
	// (再加算 = 未達チケット付与 / 一律 skip = 正当な加算の取りこぼし)。
	//
	// そこで新しい書き込みは基準を prefix に含める (`jst:2026-08`)。以後は
	// **保存値を見れば基準が分かる**ので、同じ曖昧さが再発しない。
	// prefix 無しの旧値は「基準不明」として扱う (下記 `isSameJstMonth`)。
	const currentMonth = toJstMonthKeyValue(monthKeyJST());
	const lastIncrement = await getSetting(KEYS.lastIncrementMonth, tenantId);
	if (isSameJstMonth(lastIncrement, currentMonth)) {
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
async function _applyAnnualPlanBonus(tenantId: string): Promise<{
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

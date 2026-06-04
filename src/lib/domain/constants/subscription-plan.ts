// src/lib/domain/constants/subscription-plan.ts
// #972 / #2860 PR-L5: Tenant の課金プラン (Stripe Subscription) 種別の SSOT。
// 値リテラルの直書き比較を排除し、新プラン追加時の変更点を 1 箇所に集約する。
//
// 設計原則:
//  - 値は既存 DB / Stripe との後方互換性のため kebab-case を維持
//  - 定数名は UPPER_SNAKE
//  - 派生集合 (MONTHLY_PLANS 等) を使って条件分岐を書く。個別リテラル比較は禁止
//  - UI 表示ラベルは $lib/domain/labels.ts の getSubscriptionPlanLabel() を使う。本ファイルは値のみ

export const SUBSCRIPTION_PLAN = {
	MONTHLY: 'monthly',
	YEARLY: 'yearly',
	FAMILY_MONTHLY: 'family-monthly',
	FAMILY_YEARLY: 'family-yearly',
	LIFETIME: 'lifetime',
} as const;

export type SubscriptionPlan = (typeof SUBSCRIPTION_PLAN)[keyof typeof SUBSCRIPTION_PLAN];

/** 全プラン値の配列 (zod schema / 網羅性テスト用) */
export const ALL_SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
	SUBSCRIPTION_PLAN.MONTHLY,
	SUBSCRIPTION_PLAN.YEARLY,
	SUBSCRIPTION_PLAN.FAMILY_MONTHLY,
	SUBSCRIPTION_PLAN.FAMILY_YEARLY,
	SUBSCRIPTION_PLAN.LIFETIME,
] as const;

/** 月次課金プラン (30 日周期) */
export const MONTHLY_PLANS: readonly SubscriptionPlan[] = [
	SUBSCRIPTION_PLAN.MONTHLY,
	SUBSCRIPTION_PLAN.FAMILY_MONTHLY,
] as const;

/** 年次課金プラン (365 日周期) */
export const YEARLY_PLANS: readonly SubscriptionPlan[] = [
	SUBSCRIPTION_PLAN.YEARLY,
	SUBSCRIPTION_PLAN.FAMILY_YEARLY,
] as const;

/** family ティア (monthly + yearly) */
export const FAMILY_PLANS: readonly SubscriptionPlan[] = [
	SUBSCRIPTION_PLAN.FAMILY_MONTHLY,
	SUBSCRIPTION_PLAN.FAMILY_YEARLY,
] as const;

/** standard ティア (monthly + yearly、family 以外の有料) */
export const STANDARD_PLANS: readonly SubscriptionPlan[] = [
	SUBSCRIPTION_PLAN.MONTHLY,
	SUBSCRIPTION_PLAN.YEARLY,
] as const;

export function isMonthlyPlan(plan: SubscriptionPlan): boolean {
	return MONTHLY_PLANS.includes(plan);
}

export function isYearlyPlan(plan: SubscriptionPlan): boolean {
	return YEARLY_PLANS.includes(plan);
}

export function isFamilyPlan(plan: SubscriptionPlan): boolean {
	return FAMILY_PLANS.includes(plan);
}

export function isLifetimePlan(plan: SubscriptionPlan): boolean {
	return plan === SUBSCRIPTION_PLAN.LIFETIME;
}

/** #972: plan → 有効期間日数。lifetime は undefined (期限なし) */
export function planDurationDays(plan: SubscriptionPlan): number | undefined {
	switch (plan) {
		case SUBSCRIPTION_PLAN.LIFETIME:
			return undefined;
		case SUBSCRIPTION_PLAN.MONTHLY:
		case SUBSCRIPTION_PLAN.FAMILY_MONTHLY:
			return 30;
		case SUBSCRIPTION_PLAN.YEARLY:
		case SUBSCRIPTION_PLAN.FAMILY_YEARLY:
			return 365;
		default: {
			// 型で網羅済みだが将来プラン追加時のガード
			const _exhaustive: never = plan;
			throw new Error(`[subscription-plan] unknown plan: ${String(_exhaustive)}`);
		}
	}
}

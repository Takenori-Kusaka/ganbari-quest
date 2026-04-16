// src/lib/domain/constants/subscription-status.ts
// #972: Tenant.status (Stripe 連動のテナント購読状態) の SSOT。
// Stripe subscription の状態をアプリ内の状態機械に落とし込んだもの。
//
// 遷移 (ADR-0022):
//   active → grace_period (支払い失敗の猶予期間)
//          → suspended (猶予期間経過で機能停止)
//          → terminated (解約確定)
//   cancel_at_period_end で suspended に移行する経路もある

export const SUBSCRIPTION_STATUS = {
	/** 購読中 (Stripe subscription active) */
	ACTIVE: 'active',
	/** 支払い失敗の猶予期間 (past_due 相当) */
	GRACE_PERIOD: 'grace_period',
	/** 機能停止 (猶予経過後 / cancel_at_period_end 通過後) */
	SUSPENDED: 'suspended',
	/** 完全解約 */
	TERMINATED: 'terminated',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const ALL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
	SUBSCRIPTION_STATUS.ACTIVE,
	SUBSCRIPTION_STATUS.GRACE_PERIOD,
	SUBSCRIPTION_STATUS.SUSPENDED,
	SUBSCRIPTION_STATUS.TERMINATED,
] as const;

/** 機能が利用可能な status (active + 猶予期間中) */
export const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
	SUBSCRIPTION_STATUS.ACTIVE,
	SUBSCRIPTION_STATUS.GRACE_PERIOD,
] as const;

export function isEntitledStatus(status: SubscriptionStatus): boolean {
	return ENTITLED_SUBSCRIPTION_STATUSES.includes(status);
}

export function isSubscriptionActive(status: SubscriptionStatus): boolean {
	return status === SUBSCRIPTION_STATUS.ACTIVE;
}

export function isSubscriptionSuspended(status: SubscriptionStatus): boolean {
	return status === SUBSCRIPTION_STATUS.SUSPENDED;
}

export function isSubscriptionTerminated(status: SubscriptionStatus): boolean {
	return status === SUBSCRIPTION_STATUS.TERMINATED;
}

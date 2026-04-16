// tests/unit/domain/subscription-status-constants.test.ts
// #972: SUBSCRIPTION_STATUS 定数 / 派生集合 / ヘルパの網羅性テスト

import { describe, expect, it } from 'vitest';
import {
	ALL_SUBSCRIPTION_STATUSES,
	ENTITLED_SUBSCRIPTION_STATUSES,
	isEntitledStatus,
	isSubscriptionActive,
	isSubscriptionSuspended,
	isSubscriptionTerminated,
	SUBSCRIPTION_STATUS,
} from '../../../src/lib/domain/constants/subscription-status';

describe('SUBSCRIPTION_STATUS 定数', () => {
	it('値は snake_case (既存 DB 互換)', () => {
		expect(SUBSCRIPTION_STATUS.ACTIVE).toBe('active');
		expect(SUBSCRIPTION_STATUS.GRACE_PERIOD).toBe('grace_period');
		expect(SUBSCRIPTION_STATUS.SUSPENDED).toBe('suspended');
		expect(SUBSCRIPTION_STATUS.TERMINATED).toBe('terminated');
	});

	it('ALL_SUBSCRIPTION_STATUSES は全 status を含む', () => {
		expect(ALL_SUBSCRIPTION_STATUSES).toHaveLength(4);
		expect(new Set(ALL_SUBSCRIPTION_STATUSES).size).toBe(ALL_SUBSCRIPTION_STATUSES.length);
	});

	it('ALL_SUBSCRIPTION_STATUSES は SUBSCRIPTION_STATUS の全 value と一致', () => {
		const values = Object.values(SUBSCRIPTION_STATUS).sort();
		const all = [...ALL_SUBSCRIPTION_STATUSES].sort();
		expect(all).toEqual(values);
	});
});

describe('ENTITLED_SUBSCRIPTION_STATUSES (機能利用可能集合)', () => {
	it('active + grace_period のみ entitled', () => {
		expect(ENTITLED_SUBSCRIPTION_STATUSES).toEqual([
			SUBSCRIPTION_STATUS.ACTIVE,
			SUBSCRIPTION_STATUS.GRACE_PERIOD,
		]);
	});

	it('isEntitledStatus は entitled 集合と一致', () => {
		expect(isEntitledStatus(SUBSCRIPTION_STATUS.ACTIVE)).toBe(true);
		expect(isEntitledStatus(SUBSCRIPTION_STATUS.GRACE_PERIOD)).toBe(true);
		expect(isEntitledStatus(SUBSCRIPTION_STATUS.SUSPENDED)).toBe(false);
		expect(isEntitledStatus(SUBSCRIPTION_STATUS.TERMINATED)).toBe(false);
	});
});

describe('ヘルパ関数 (単一 status)', () => {
	it('isSubscriptionActive', () => {
		expect(isSubscriptionActive(SUBSCRIPTION_STATUS.ACTIVE)).toBe(true);
		expect(isSubscriptionActive(SUBSCRIPTION_STATUS.GRACE_PERIOD)).toBe(false);
		expect(isSubscriptionActive(SUBSCRIPTION_STATUS.SUSPENDED)).toBe(false);
		expect(isSubscriptionActive(SUBSCRIPTION_STATUS.TERMINATED)).toBe(false);
	});

	it('isSubscriptionSuspended', () => {
		expect(isSubscriptionSuspended(SUBSCRIPTION_STATUS.SUSPENDED)).toBe(true);
		expect(isSubscriptionSuspended(SUBSCRIPTION_STATUS.ACTIVE)).toBe(false);
	});

	it('isSubscriptionTerminated', () => {
		expect(isSubscriptionTerminated(SUBSCRIPTION_STATUS.TERMINATED)).toBe(true);
		expect(isSubscriptionTerminated(SUBSCRIPTION_STATUS.ACTIVE)).toBe(false);
	});
});

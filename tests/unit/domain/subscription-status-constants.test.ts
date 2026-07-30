// tests/unit/domain/subscription-status-constants.test.ts
// #972: SUBSCRIPTION_STATUS 定数 / 派生集合 / ヘルパの網羅性テスト

import { describe, expect, it } from 'vitest';
import {
	ALL_SUBSCRIPTION_STATUSES,
	ENTITLED_SUBSCRIPTION_STATUSES,
	isChurnedContract,
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

	it('isSubscriptionTerminated は退会済み (S6) のみを指し、解約 (S5) は含まない', () => {
		// S5 = 解約確定。terminated ではなく suspended + sub なしで表現される (#3987)。
		expect(isSubscriptionTerminated(SUBSCRIPTION_STATUS.SUSPENDED)).toBe(false);
	});
});

describe('#3987: isChurnedContract (チャーン判定 SSOT)', () => {
	it('S5 契約終了 (suspended + subscription なし) はチャーンに数える', () => {
		expect(
			isChurnedContract({ status: SUBSCRIPTION_STATUS.SUSPENDED, stripeSubscriptionId: null }),
		).toBe(true);
		// undefined (列を読まなかった / 未設定) も「割り当てなし」として扱う
		expect(
			isChurnedContract({ status: SUBSCRIPTION_STATUS.SUSPENDED, stripeSubscriptionId: undefined }),
		).toBe(true);
		expect(isChurnedContract({ status: SUBSCRIPTION_STATUS.SUSPENDED })).toBe(true);
	});

	it('S4 停止 (suspended + subscription あり) はチャーンに数えない — 復帰しうる', () => {
		expect(
			isChurnedContract({ status: SUBSCRIPTION_STATUS.SUSPENDED, stripeSubscriptionId: 'sub_1' }),
		).toBe(false);
	});

	it('S6 退会済 (terminated) は subscription の有無に関わらずチャーンに数える', () => {
		expect(
			isChurnedContract({ status: SUBSCRIPTION_STATUS.TERMINATED, stripeSubscriptionId: null }),
		).toBe(true);
		expect(
			isChurnedContract({ status: SUBSCRIPTION_STATUS.TERMINATED, stripeSubscriptionId: 'sub_1' }),
		).toBe(true);
	});

	it('active / grace_period はチャーンではない', () => {
		expect(
			isChurnedContract({ status: SUBSCRIPTION_STATUS.ACTIVE, stripeSubscriptionId: 'sub_1' }),
		).toBe(false);
		expect(isChurnedContract({ status: SUBSCRIPTION_STATUS.ACTIVE })).toBe(false);
		expect(
			isChurnedContract({
				status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
				stripeSubscriptionId: 'sub_1',
			}),
		).toBe(false);
		// 契約が無い grace_period (X4 不正状態) も entitle 中なのでチャーンにはしない
		expect(isChurnedContract({ status: SUBSCRIPTION_STATUS.GRACE_PERIOD })).toBe(false);
	});
});

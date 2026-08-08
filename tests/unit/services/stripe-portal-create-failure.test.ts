// tests/unit/services/stripe-portal-create-failure.test.ts
// #4329 ① — portal session を作れなかったことを「型付きの失敗」として返し、運用側に上げる。
//
// 旧実装は `sessions.create` の throw を呼び出し元へ素通ししていた。解約フローではそれが
// 顧客に届く前に fallthrough し、**顧客も運営も気づけない**まま課金が続く経路になっていた。
//
// 固定する不変条件:
//   1. flow なし経路 / flow 拒否後の作り直し経路の**どちらの throw でも** throw せず失敗を返す
//   2. 失敗は Discord alert (運用側) に上がる
//   3. alert payload に顧客識別子 (tenantId) を載せない (#4174 Q3)
//   4. 成功経路の戻り値は従来どおり (回帰防止)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockPortalCreate = vi.fn();
const mockNotifyStripeAlert = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantById: mockFindTenantById },
		webhookEvent: {
			findByEventId: async () => null,
			claim: async () => true,
			finalize: async () => {},
			releaseClaim: async () => {},
			incrementRetryCount: async () => {},
			deleteOlderThan: async () => 0,
		},
	}),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: () => ({ billingPortal: { sessions: { create: mockPortalCreate } } }),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({}),
	planIdFromPriceId: () => null,
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlert: (...args: unknown[]) => mockNotifyStripeAlert(...args),
}));
vi.mock('$lib/server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyDiscord: vi.fn(),
	notifyIncident: vi.fn(),
}));

import { createPortalSession } from '../../../src/lib/server/services/stripe-service';

const RETURN_URL = 'https://app.example/admin/subscription';
const TENANT_ID = 't-4329';

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTenantById.mockResolvedValue({
		tenantId: TENANT_ID,
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: 'sub_123',
	});
});

describe('createPortalSession: Stripe が portal を返さないとき (#4329)', () => {
	it('flow なし経路: throw せず PORTAL_CREATE_FAILED を返す', async () => {
		mockPortalCreate.mockRejectedValue(new Error('Stripe is down'));

		const result = await createPortalSession(TENANT_ID, RETURN_URL, { kind: 'home' });

		expect(result).toEqual({ error: 'PORTAL_CREATE_FAILED' });
	});

	it('flow 拒否後の作り直しも失敗したら PORTAL_CREATE_FAILED を返す', async () => {
		mockPortalCreate.mockRejectedValue(new Error('Stripe is down'));

		const result = await createPortalSession(TENANT_ID, RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect(result).toEqual({ error: 'PORTAL_CREATE_FAILED' });
	});

	it('運用側に alert が上がる（顧客も運営も気づけない状態を断つ、AC4）', async () => {
		mockPortalCreate.mockRejectedValue(new Error('Stripe is down'));

		await createPortalSession(TENANT_ID, RETURN_URL, { kind: 'subscription_cancel' });

		expect(mockNotifyStripeAlert).toHaveBeenCalledTimes(1);
		expect(mockNotifyStripeAlert.mock.calls.at(0)?.[0]).toMatchObject({
			kind: 'stripe-portal-create-failed',
		});
	});

	it('alert payload に顧客識別子を載せない (#4174 Q3)', async () => {
		mockPortalCreate.mockRejectedValue(new Error('Stripe is down'));

		await createPortalSession(TENANT_ID, RETURN_URL, { kind: 'subscription_cancel' });

		expect(JSON.stringify(mockNotifyStripeAlert.mock.calls.at(0)?.[0])).not.toContain(TENANT_ID);
	});

	it('成功経路の戻り値は従来どおり（回帰防止）', async () => {
		mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session_ok' });

		const result = await createPortalSession(TENANT_ID, RETURN_URL, { kind: 'home' });

		expect(result).toEqual({ url: 'https://billing.stripe.com/session_ok' });
		expect(mockNotifyStripeAlert).not.toHaveBeenCalled();
	});
});

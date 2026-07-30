// tests/unit/services/period-end-cancellation-chain.test.ts
// #3991 (#3986 統合): 期末解約の **連鎖** を 1 本で通し、各段の最終状態を固定する。
//
// 旧テストは cancel と reactivate をそれぞれ単体で検証していたため、
// 「cancel → 直後に届く webhook が状態を上書きして取り消し導線が死ぬ」という
// 連鎖でしか現れない欠陥が全緑のまま通過していた (#3991 事実節)。
//
// 検証する連鎖:
//   1. 解約予約         scheduleCancellationAtPeriodEnd → cancel_at_period_end=true
//   2. webhook 到着     customer.subscription.updated (status=active, cancel_at_period_end=true)
//                       → 有料のまま (ACTIVE / plan 維持)。ここで suspended に落ちないことが要
//   3. 取り消し         resumeSubscription → cancel_at_period_end=false
//   4. webhook 到着     customer.subscription.updated (status=active) → ACTIVE のまま
//   5. 期末到来         customer.subscription.deleted → 終端 (suspended / plan・subscription クリア)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockFindTenantByStripeCustomerId = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: mockUpdateTenantStripe,
			findTenantByStripeCustomerId: mockFindTenantByStripeCustomerId,
		},
		// #3985 (PR #4079): handleWebhookEvent は dispatcher 入口で event.id dedup を行う。
		// 本 spec の関心は「予約 → webhook → 取り消し → webhook → 期末」の状態遷移なので、
		// dedup は常に「初回到達」として素通しする。
		webhookEvent: {
			findByEventId: async () => null,
			insert: async () => {},
			incrementRetryCount: async () => {},
			deleteOlderThan: async () => 0,
		},
	}),
}));

const mockIsStripeEnabled = vi.fn();
const mockGetStripeClient = vi.fn();

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: (...args: unknown[]) => mockIsStripeEnabled(...args),
	getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
	}),
	planIdFromPriceId: (priceId: string) => (priceId === 'price_monthly_123' ? 'monthly' : null),
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/alert', () => ({
	notifyStripeAlert: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
	handleWebhookEvent,
	resumeSubscription,
	scheduleCancellationAtPeriodEnd,
} from '../../../src/lib/server/services/stripe-service';

// ---------- Fixtures ----------

const SUBSCRIPTION_ID = 'sub_chain';
// apiVersion 2026-04-22.dahlia では current_period_end は subscription item に載る
const PERIOD_END_EPOCH = Math.floor(Date.UTC(2026, 1, 1) / 1000);

function makeTenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: 't-chain',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_chain',
		stripeSubscriptionId: SUBSCRIPTION_ID,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

function makeSubscription(
	overrides: { cancelAtPeriodEnd?: boolean; status?: string } = {},
): Record<string, unknown> {
	return {
		id: SUBSCRIPTION_ID,
		customer: 'cus_chain',
		status: overrides.status ?? 'active',
		cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
		metadata: { tenantId: 't-chain' },
		items: {
			data: [
				{
					price: { id: 'price_monthly_123', lookup_key: null },
					current_period_end: PERIOD_END_EPOCH,
				},
			],
		},
	};
}

const mockRetrieve = vi.fn();
const mockUpdate = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockFindTenantById.mockResolvedValue(makeTenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockGetStripeClient.mockReturnValue({
		subscriptions: { retrieve: mockRetrieve, update: mockUpdate },
	});
});

/** updateTenantStripe に渡された最後の patch */
function lastPatch(): Record<string, unknown> | undefined {
	const calls = mockUpdateTenantStripe.mock.calls;
	return calls.length > 0 ? (calls[calls.length - 1]?.[1] as Record<string, unknown>) : undefined;
}

describe('期末解約の連鎖 (#3991)', () => {
	it('解約予約 → webhook → 取り消し → webhook → 期末 deleted の各段で最終状態が期待どおり', async () => {
		// --- 1. 解約予約 ---
		mockRetrieve.mockResolvedValueOnce(makeSubscription({ cancelAtPeriodEnd: false }));
		mockUpdate.mockResolvedValueOnce(makeSubscription({ cancelAtPeriodEnd: true }));

		const scheduled = await scheduleCancellationAtPeriodEnd('t-chain');
		expect(scheduled.status).toBe('scheduled');
		expect(mockUpdate).toHaveBeenCalledWith(SUBSCRIPTION_ID, { cancel_at_period_end: true });
		if (scheduled.status !== 'scheduled') throw new Error('unreachable');
		expect(scheduled.state.cancelAtPeriodEnd).toBe(true);
		expect(scheduled.state.currentPeriodEnd).toBe(new Date(PERIOD_END_EPOCH * 1000).toISOString());
		// 予約は Stripe 側だけで完結する (契約状態の DB 書き込みは無い)
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();

		// --- 2. 予約直後に届く customer.subscription.updated ---
		// 即時キャンセルではないので status は active のまま。有料機能を落としてはならない。
		await handleWebhookEvent({
			id: 'evt_scheduled',
			type: 'customer.subscription.updated',
			data: { object: makeSubscription({ cancelAtPeriodEnd: true }) },
		} as never);
		expect(lastPatch()).toMatchObject({ status: 'active', plan: 'monthly' });

		// --- 3. 取り消し ---
		mockUpdateTenantStripe.mockClear();
		mockRetrieve.mockResolvedValueOnce(makeSubscription({ cancelAtPeriodEnd: true }));
		mockUpdate.mockResolvedValueOnce(makeSubscription({ cancelAtPeriodEnd: false }));

		const resumed = await resumeSubscription('t-chain');
		expect(resumed.status).toBe('resumed');
		expect(mockUpdate).toHaveBeenLastCalledWith(SUBSCRIPTION_ID, { cancel_at_period_end: false });
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();

		// --- 4. 取り消し後の customer.subscription.updated ---
		await handleWebhookEvent({
			id: 'evt_resumed',
			type: 'customer.subscription.updated',
			data: { object: makeSubscription({ cancelAtPeriodEnd: false }) },
		} as never);
		expect(lastPatch()).toMatchObject({ status: 'active', plan: 'monthly' });

		// --- 5. 期末到来 (取り消さなかった場合の終端) ---
		mockUpdateTenantStripe.mockClear();
		await handleWebhookEvent({
			id: 'evt_deleted',
			type: 'customer.subscription.deleted',
			data: { object: makeSubscription({ cancelAtPeriodEnd: true, status: 'canceled' }) },
		} as never);
		// #3982 の終端収束と一致: subscription 参照と plan をクリアし suspended へ
		expect(lastPatch()).toMatchObject({
			status: 'suspended',
			plan: null,
			stripeSubscriptionId: null,
		});
	});

	it('#3986: dunning 中 (cancel_at_period_end=false) は resumeSubscription が not_scheduled を返す', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ status: 'grace_period' }));
		mockRetrieve.mockResolvedValueOnce(
			makeSubscription({ cancelAtPeriodEnd: false, status: 'past_due' }),
		);

		const result = await resumeSubscription('t-chain');
		expect(result.status).toBe('not_scheduled');
		// Stripe 側も DB 側も書き換えない
		expect(mockUpdate).not.toHaveBeenCalled();
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('二重の解約申請は Stripe を書き換えず already_scheduled を返す', async () => {
		mockRetrieve.mockResolvedValueOnce(makeSubscription({ cancelAtPeriodEnd: true }));
		const result = await scheduleCancellationAtPeriodEnd('t-chain');
		expect(result.status).toBe('already_scheduled');
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('契約が無いテナントは not_subscribed (Stripe を呼ばない)', async () => {
		mockFindTenantById.mockResolvedValue(makeTenant({ stripeSubscriptionId: null }));
		await expect(scheduleCancellationAtPeriodEnd('t-chain')).resolves.toEqual({
			status: 'not_subscribed',
		});
		expect(mockRetrieve).not.toHaveBeenCalled();
	});

	it('Stripe 上に subscription が無い (resource_missing) 場合も not_subscribed', async () => {
		mockRetrieve.mockRejectedValueOnce({ code: 'resource_missing' });
		await expect(resumeSubscription('t-chain')).resolves.toEqual({ status: 'not_subscribed' });
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('subscription を持つのに Stripe 無効な環境では例外で中断する (課金継続クレーム防止)', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		await expect(scheduleCancellationAtPeriodEnd('t-chain')).rejects.toThrow();
	});
});

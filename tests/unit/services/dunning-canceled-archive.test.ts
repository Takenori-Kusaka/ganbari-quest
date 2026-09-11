// tests/unit/services/dunning-canceled-archive.test.ts
// #4585-3: 支払い失敗による強制 free 化 (dunning) の archive を固定する。
//
// ## なぜ必要か
//
// PO 決裁 (#4585): 支払い失敗による強制 free 化は **顧客が選択画面を通れない唯一の経路**
// (本人が操作していない)。ここで何が残るかが未定義のまま有償を始めない、という判断で
// `dunning_canceled` を実装する。fallback 規則は解約フロー / 請求パネルと同じ
// `archiveExcessResources` (子供は直近の利用順、活動・チェックリストは登録順) を共有する。
//
// 「支払い失敗で終わった契約」だと分かるのは Stripe の `cancellation_details.reason` を
// 持つ webhook の瞬間だけで、次に顧客が管理画面へ来た時点では S5 (契約終了) に収束して
// 自発的な解約と区別できない。よって reason の刻印は本経路でしか行えない。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks（stripe-webhook-contract-state.test.ts と同型） ----------

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
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockArchiveExcessResources = vi.fn();

vi.mock('$lib/server/services/resource-archive-service', () => ({
	archiveExcessResources: (...args: unknown[]) => mockArchiveExcessResources(...args),
}));

import { handleWebhookEvent } from '../../../src/lib/server/services/stripe-service';

const SUB_ID = 'sub_dunning';
const TENANT_ID = 't-dunning';

function tenant() {
	return {
		tenantId: TENANT_ID,
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_dunning',
		stripeSubscriptionId: SUB_ID,
		planExpiresAt: null,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
	};
}

/** `customer.subscription.deleted` の fixture。`cancellation_details.reason` を差し替える。 */
function deletedEvent(cancellationReason: string | null) {
	return {
		id: `evt_deleted_${cancellationReason ?? 'none'}`,
		type: 'customer.subscription.deleted',
		data: {
			object: {
				id: SUB_ID,
				customer: 'cus_dunning',
				status: 'canceled',
				metadata: { tenantId: TENANT_ID },
				items: { data: [{ price: { id: 'price_monthly_123' } }] },
				cancellation_details: cancellationReason ? { reason: cancellationReason } : undefined,
			},
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockGetStripeClient.mockReturnValue({
		subscriptions: {
			retrieve: vi.fn().mockResolvedValue({
				id: SUB_ID,
				customer: 'cus_dunning',
				status: 'canceled',
				items: { data: [{ price: { id: 'price_monthly_123' } }] },
			}),
		},
	});
	mockFindTenantById.mockResolvedValue(tenant());
	mockFindTenantByStripeCustomerId.mockResolvedValue(tenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockArchiveExcessResources.mockResolvedValue({
		archivedChildIds: ['3'],
		archivedActivityIds: [],
		archivedChecklistTemplateIds: [],
	});
});

describe('#4585-3 dunning_canceled — 支払い失敗による強制 free 化', () => {
	it('支払い失敗で契約が消えたら dunning_canceled で archive する', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(deletedEvent('payment_failure') as any);

		expect(mockArchiveExcessResources).toHaveBeenCalledWith(TENANT_ID, 'dunning_canceled');
	});

	it('顧客自身の解約 (cancellation_requested) では archive しない（選択画面を通る経路）', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(deletedEvent('cancellation_requested') as any);

		expect(mockArchiveExcessResources).not.toHaveBeenCalled();
	});

	it('理由が付かない subscription.deleted でも archive しない', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(deletedEvent(null) as any);

		expect(mockArchiveExcessResources).not.toHaveBeenCalled();
	});

	it('archive が失敗しても webhook 自体は成功で返す（Stripe に再送させない）', async () => {
		mockArchiveExcessResources.mockRejectedValue(new Error('db down'));

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		const result = await handleWebhookEvent(deletedEvent('payment_failure') as any);

		expect(result).not.toBe('error');
		// 契約状態の書き込み自体は完了している
		expect(mockUpdateTenantStripe).toHaveBeenCalled();
	});

	it('契約状態の書き込みに失敗したときは archive しない（free 化していない）', async () => {
		// 現契約と一致しない subscription id → applyTenantContractState が書かずに抜ける
		mockFindTenantById.mockResolvedValue({ ...tenant(), stripeSubscriptionId: 'sub_other' });
		mockFindTenantByStripeCustomerId.mockResolvedValue({
			...tenant(),
			stripeSubscriptionId: 'sub_other',
		});

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(deletedEvent('payment_failure') as any);

		expect(mockArchiveExcessResources).not.toHaveBeenCalled();
	});
});

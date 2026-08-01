// tests/unit/services/stripe-plan-drift-service.test.ts
//
// #4128 AC5: plan 逆引き不能で滞留している契約が /ops から確認できること。
//
// `stripe-plan-unresolved` alert はその瞬間の 1 通でしかなく、Stripe 側で Price を差し替えて
// env を更新し忘れた状態は「顧客が払っている額と使える機能が食い違ったまま」滞留する。
// 復旧対象がどこにも一覧されないと対応が人の記憶に依存する (Issue #4128 No-gos)。
//
// 守る不変条件:
//   [P1] 解決できない契約は tenant / price / 保持中 plan つきで列挙される
//   [P2] 解決できる契約は列挙されない (常に全件返す実装を弾く)
//   [P3] 顧客影響の無い status (canceled 等) はノイズとして除外する
//   [P4] 照会失敗を「0 件」に見せない (error を返す)
//   [P5] Stripe 無効環境では検査しない

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantByStripeCustomerId = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantByStripeCustomerId: mockFindTenantByStripeCustomerId },
	}),
}));

const mockIsStripeEnabled = vi.fn();
const mockSubscriptionsList = vi.fn();

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => mockIsStripeEnabled(),
	getStripeClient: () => ({ subscriptions: { list: mockSubscriptionsList } }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// plan 解決は webhook 経路と同一の実体を使う (ops 専用の別判定を作らない)。
// ここでは既知 price だけが解決できる状態を作る。
vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_known', lookupKey: 'standard_monthly' },
	}),
	planIdFromPriceId: (priceId: string) => (priceId === 'price_known' ? 'monthly' : null),
	planIdFromLookupKey: (key: string | null | undefined) =>
		key === 'standard_monthly' ? 'monthly' : null,
	getWebhookSecret: () => 'whsec_test',
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));

const { checkPlanResolution } = await import(
	'../../../src/lib/server/services/stripe-plan-drift-service'
);

function subscription(opts: {
	id?: string;
	status?: string;
	priceId?: string | null;
	lookupKey?: string | null;
	customer?: string;
	itemCount?: number;
}) {
	const price =
		opts.priceId === null
			? undefined
			: { id: opts.priceId ?? 'price_unknown', lookup_key: opts.lookupKey ?? null };
	const items = Array.from({ length: opts.itemCount ?? 1 }, () => ({ price }));
	return {
		id: opts.id ?? 'sub_1',
		status: opts.status ?? 'active',
		customer: opts.customer ?? 'cus_1',
		items: { data: items },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockSubscriptionsList.mockResolvedValue({ data: [] });
	mockFindTenantByStripeCustomerId.mockResolvedValue({
		tenantId: 'tenant-1',
		plan: 'monthly',
	});
});

describe('#4128 [P1] 解決できない契約を tenant / price つきで列挙する', () => {
	it('env / lookup_key と一致しない Price の契約が滞留として出る', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [subscription({ id: 'sub_drift', priceId: 'price_replaced', lookupKey: 'legacy' })],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved).toEqual([
			{
				subscriptionId: 'sub_drift',
				subscriptionStatus: 'active',
				tenantId: 'tenant-1',
				currentPlan: 'monthly',
				priceId: 'price_replaced',
				lookupKey: 'legacy',
				itemCount: 1,
			},
		]);
	});

	it('tenant を特定できなくても滞留として出す (判定不能を沈黙させない)', async () => {
		mockSubscriptionsList.mockResolvedValue({ data: [subscription({ priceId: 'price_x' })] });
		mockFindTenantByStripeCustomerId.mockResolvedValue(undefined);

		const report = await checkPlanResolution();

		expect(report.unresolved).toHaveLength(1);
		expect(report.unresolved[0]?.tenantId).toBeNull();
	});

	it('item が複数ある契約は件数が載る (先頭参照の前提が崩れた印、#3980)', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [subscription({ priceId: 'price_x', itemCount: 3 })],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved[0]?.itemCount).toBe(3);
	});
});

describe('#4128 [P2] 解決できる契約は列挙しない', () => {
	it('env の priceId と一致すれば滞留に出ない', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [subscription({ id: 'sub_ok', priceId: 'price_known' })],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved).toEqual([]);
		expect(report.checked).toBe(1);
	});

	it('priceId が違っても lookup_key で解決できれば滞留に出ない', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [subscription({ priceId: 'price_new', lookupKey: 'standard_monthly' })],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved).toEqual([]);
	});

	it('解決できる契約と できない契約が混在しても後者だけが出る', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [
				subscription({ id: 'sub_ok', priceId: 'price_known' }),
				subscription({ id: 'sub_ng', priceId: 'price_x' }),
			],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved.map((r) => r.subscriptionId)).toEqual(['sub_ng']);
		expect(report.checked).toBe(2);
	});
});

describe('#4128 [P3] 顧客影響の無い契約は除外する', () => {
	it('canceled / incomplete_expired は解決不能でも列挙しない', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [
				subscription({ id: 'sub_canceled', status: 'canceled', priceId: 'price_x' }),
				subscription({ id: 'sub_expired', status: 'incomplete_expired', priceId: 'price_x' }),
			],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved).toEqual([]);
		expect(report.checked).toBe(0);
	});

	it('past_due / trialing は課金対象なので列挙する', async () => {
		mockSubscriptionsList.mockResolvedValue({
			data: [
				subscription({ id: 'sub_past_due', status: 'past_due', priceId: 'price_x' }),
				subscription({ id: 'sub_trialing', status: 'trialing', priceId: 'price_x' }),
			],
		});

		const report = await checkPlanResolution();

		expect(report.unresolved.map((r) => r.subscriptionId)).toEqual([
			'sub_past_due',
			'sub_trialing',
		]);
	});
});

describe('#4128 [P4] 照会失敗を「0 件」に見せない', () => {
	it('Stripe API が落ちたら error を返す (unresolved 空 = 正常 と誤読させない)', async () => {
		mockSubscriptionsList.mockRejectedValue(new TypeError('fetch failed'));

		const report = await checkPlanResolution();

		expect(report.error).toBe('TypeError');
		expect(report.unresolved).toEqual([]);
	});

	it('error には例外の生 message を載せない (接続情報の露出を作らない)', async () => {
		mockSubscriptionsList.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:5432'));

		const report = await checkPlanResolution();

		expect(report.error).toBe('Error');
		expect(JSON.stringify(report)).not.toContain('10.0.0.1');
	});
});

describe('#4128 [P5] Stripe 無効環境では検査しない', () => {
	it('isStripeEnabled=false なら Stripe API を叩かない', async () => {
		mockIsStripeEnabled.mockReturnValue(false);

		const report = await checkPlanResolution();

		expect(report.skipped).toBe('stripe-disabled');
		expect(mockSubscriptionsList).not.toHaveBeenCalled();
	});
});

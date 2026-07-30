// tests/unit/services/stripe-checkout-reconciliation.test.ts
// #3958: checkout 完了の reconciliation 経路 (success_url の session_id 照合)
//
// 背景 (2026-07-26 本番 incident): webhook が CloudFront geo 制限で未達となったとき、
// 顧客側に復旧手段が一切なかった。success_url には `session_id` が付いて戻ってくるのに、
// それを読む実装が `src/` に 1 件も存在しなかった (生成箇所 1 行のみ)。
//
// 本 test は「webhook が届かないまま success_url に戻ってきた場合に契約状態が反映される」
// および「何度戻ってきても副作用が 1 回だけ」を assert する (failing-test-first, ADR-0061)。
//
// 冪等の担保方法:
//   - 反映の書き込みは webhook handler (`handleCheckoutCompleted`) と**同一経路**に合流させる
//     (二重実装しない / #4077 の単一強制点を迂回しない)
//   - 反映前にテナントの現契約と session の subscription を突合し、既に一致していれば
//     **書き込みも通知も行わない** (webhook 先着 / 2 回目のアクセス双方をここで吸収)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks ----------

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
		'family-monthly': {
			priceId: 'price_family_monthly_789',
			amount: 780,
			interval: 'month',
			label: 'プレミアム月額',
		},
	}),
	planIdFromPriceId: (priceId: string) =>
		priceId === 'price_monthly_123'
			? 'monthly'
			: priceId === 'price_family_monthly_789'
				? 'family-monthly'
				: null,
	getWebhookSecret: () => 'whsec_test',
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockNotifyBillingEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: (...args: unknown[]) => mockNotifyBillingEvent(...args),
}));

// ---------- Import after mocks ----------

import {
	handleWebhookEvent,
	reconcileCheckoutSession,
} from '../../../src/lib/server/services/stripe-service';

// ---------- Helpers ----------

const TENANT_ID = 't-test';
const SESSION_ID = 'cs_test_a1b2c3d4e5f6g7h8';

function makeTenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: TENANT_ID,
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'free',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: null,
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

/** Stripe から返る checkout session (支払い済み) */
function makePaidSession(overrides: Record<string, unknown> = {}) {
	return {
		id: SESSION_ID,
		payment_status: 'paid',
		status: 'complete',
		metadata: { tenantId: TENANT_ID, planId: 'monthly' },
		customer: 'cus_123',
		subscription: 'sub_new',
		...overrides,
	};
}

const mockSessionRetrieve = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockFindTenantById.mockResolvedValue(makeTenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockSessionRetrieve.mockResolvedValue(makePaidSession());
	// #4081: reconcileCheckoutSession は session.subscription を Stripe から再 retrieve して
	// 終端状態 (canceled / incomplete_expired) でないかを確認する。既定は「生きている」
	// subscription を返し、既存の正常系 (AC1〜AC4) が壊れないようにする。
	mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_new', status: 'active' });
	mockGetStripeClient.mockReturnValue({
		checkout: { sessions: { retrieve: mockSessionRetrieve } },
		subscriptions: { retrieve: mockSubscriptionsRetrieve },
	});
});

// ==========================================================
// AC1: webhook 未達でも success_url 復帰だけでプランが反映される
// ==========================================================

describe('reconcileCheckoutSession — 反映 (AC1)', () => {
	it('webhook 未達のまま success_url に戻ると、webhook と同じ内容で契約状態が反映される', async () => {
		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('applied');
		// 照合は必ずサーバー側で Stripe に問い合わせる (URL の申告を信用しない)
		expect(mockSessionRetrieve).toHaveBeenCalledWith(SESSION_ID);
		// 書き込み内容は handleCheckoutCompleted と同一 (二重実装しない)
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			TENANT_ID,
			expect.objectContaining({
				stripeCustomerId: 'cus_123',
				stripeSubscriptionId: 'sub_new',
				plan: 'monthly',
				status: 'active',
			}),
		);
	});

	it('100% OFF クーポン (payment_status=no_payment_required) でも反映される', async () => {
		mockSessionRetrieve.mockResolvedValue(
			makePaidSession({ payment_status: 'no_payment_required', amount_total: 0 }),
		);

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('applied');
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
	});
});

// ==========================================================
// AC2: 他人の session_id では反映されない
// ==========================================================

describe('reconcileCheckoutSession — tenant 突合 (AC2)', () => {
	it('metadata.tenantId がログイン中 tenant と一致しない session は反映しない', async () => {
		mockSessionRetrieve.mockResolvedValue(
			makePaidSession({ metadata: { tenantId: 't-someone-else', planId: 'family-monthly' } }),
		);

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('tenant_mismatch');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockNotifyBillingEvent).not.toHaveBeenCalled();
	});

	it('metadata.tenantId が欠落した session も反映しない', async () => {
		mockSessionRetrieve.mockResolvedValue(makePaidSession({ metadata: {} }));

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('tenant_mismatch');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});
});

// ==========================================================
// AC3: 冪等 (webhook 先着 / 二重 reconcile)
// ==========================================================

describe('reconcileCheckoutSession — 冪等 (AC3)', () => {
	it('webhook が先に届いていた場合、reconcile は書き込みも通知も行わない', async () => {
		// webhook が先に契約を反映した状態を DB として与える
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_new', plan: 'monthly', status: 'active' }),
		);

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('already_applied');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockNotifyBillingEvent).not.toHaveBeenCalled();
	});

	it('同じ session_id で 2 回 reconcile しても副作用は 1 回だけ', async () => {
		// 1 回目: 未反映 → 反映される
		const first = await reconcileCheckoutSession({ tenantId: TENANT_ID, sessionId: SESSION_ID });
		expect(first.status).toBe('applied');

		// 1 回目の書き込み結果を DB に反映させたうえで 2 回目を実行する
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_new', plan: 'monthly', status: 'active' }),
		);
		const second = await reconcileCheckoutSession({ tenantId: TENANT_ID, sessionId: SESSION_ID });

		expect(second.status).toBe('already_applied');
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(mockNotifyBillingEvent).toHaveBeenCalledTimes(1);
	});

	it('reconcile が先に反映した後に webhook が届いても状態は変わらない (相互冪等)', async () => {
		await reconcileCheckoutSession({ tenantId: TENANT_ID, sessionId: SESSION_ID });
		const afterReconcile = mockUpdateTenantStripe.mock.calls.at(-1)?.[1];

		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_new', plan: 'monthly', status: 'active' }),
		);
		await handleWebhookEvent({
			type: 'checkout.session.completed',
			data: { object: makePaidSession() },
		} as never);
		const afterWebhook = mockUpdateTenantStripe.mock.calls.at(-1)?.[1];

		// webhook 側は同じ値を書き直すだけで、契約状態 (plan / status / subscription) は動かない
		expect(afterWebhook).toMatchObject({
			stripeSubscriptionId: afterReconcile?.stripeSubscriptionId,
			plan: afterReconcile?.plan,
			status: afterReconcile?.status,
		});
	});
});

// ==========================================================
// AC4: フォールバック (500 にしない)
// ==========================================================

describe('reconcileCheckoutSession — フォールバック (AC4)', () => {
	it('session_id の形式が不正なら Stripe を呼ばずに not_found を返す (例外を投げない)', async () => {
		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: 'not-a-session-id',
		});

		expect(result.status).toBe('not_found');
		expect(mockSessionRetrieve).not.toHaveBeenCalled();
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('Stripe 側で session が存在しない / 期限切れでも例外を投げず not_found を返す', async () => {
		mockSessionRetrieve.mockRejectedValue(
			Object.assign(new Error('No such checkout.session'), {
				raw: { code: 'resource_missing' },
			}),
		);

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('not_found');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('未払い (payment_status=unpaid) は反映せず pending を返す', async () => {
		mockSessionRetrieve.mockResolvedValue(makePaidSession({ payment_status: 'unpaid' }));

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('pending');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('Stripe 無効環境では Stripe を呼ばずに unavailable を返す', async () => {
		mockIsStripeEnabled.mockReturnValue(false);

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('unavailable');
		expect(mockGetStripeClient).not.toHaveBeenCalled();
	});

	it('テナントが存在しない場合も例外を投げず not_found を返す', async () => {
		mockFindTenantById.mockResolvedValue(null);

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('not_found');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});
});

// ==========================================================
// AC5 (#4081): 古い success_url の replay で二重課金が成立しない
// ==========================================================
//
// `assign-contract` (handleCheckoutCompleted の書き込みモード) は「checkout.session.completed は
// 購入時に 1 回だけ配信される」前提で突合を行わない。reconcileCheckoutSession はこの前提を
// 「顧客が何度でも叩ける経路」に接続しているため、解約後に古い session_id を再訪すると
// - 解約済みテナント (stripeSubscriptionId=null) に古い subscription が復活する
// - 再購読済みテナント (stripeSubscriptionId=sub_new) の現行契約が古い subscription で
//   上書きされ、`createCheckoutSession()` の ALREADY_SUBSCRIBED ガードが外れて二重課金が成立し得る
//
// 対策: session.subscription を Stripe から re-retrieve し、終端状態 (canceled /
// incomplete_expired) なら handleCheckoutCompleted に合流させない。

describe('reconcileCheckoutSession — 二重課金ガード (AC5、#4081)', () => {
	it('解約済みテナントが古い session_id (canceled subscription) を再訪しても契約は復活しない', async () => {
		// 解約済み = stripeSubscriptionId は null (TERMINAL_CONTRACT_STATE)
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: null, plan: null, status: 'suspended' }),
		);
		// 古い success_url が指す session の subscription は Stripe 上では既に解約済み
		mockSessionRetrieve.mockResolvedValue(makePaidSession({ subscription: 'sub_old' }));
		mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_old', status: 'canceled' });

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).not.toBe('applied');
		expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_old');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('再購読済みテナントの現行 subscription が、古い session の canceled subscription で上書きされない', async () => {
		// 解約 → 再購読済み。現行契約は sub_new
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_new', plan: 'monthly', status: 'active' }),
		);
		// ブックマーク / 履歴から古い (解約済み) checkout session を再訪
		mockSessionRetrieve.mockResolvedValue(makePaidSession({ subscription: 'sub_old' }));
		mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_old', status: 'canceled' });

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).not.toBe('applied');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('incomplete_expired の subscription も終端として扱い、反映しない', async () => {
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: null, plan: null, status: 'suspended' }),
		);
		mockSessionRetrieve.mockResolvedValue(makePaidSession({ subscription: 'sub_old' }));
		mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_old', status: 'incomplete_expired' });

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).not.toBe('applied');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('正常系 (回帰): 初回購入で subscription が生きていれば従来通り反映される', async () => {
		// tenant は未契約、session の subscription (sub_new) は Stripe 上でも active
		mockFindTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: null, plan: 'free', status: 'active' }),
		);
		mockSessionRetrieve.mockResolvedValue(makePaidSession({ subscription: 'sub_new' }));
		mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_new', status: 'active' });

		const result = await reconcileCheckoutSession({
			tenantId: TENANT_ID,
			sessionId: SESSION_ID,
		});

		expect(result.status).toBe('applied');
		expect(mockUpdateTenantStripe).toHaveBeenCalledTimes(1);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			TENANT_ID,
			expect.objectContaining({ stripeSubscriptionId: 'sub_new', status: 'active' }),
		);
	});
});

// tests/unit/services/stripe-portal-flow.test.ts
// #4166 — portal session が「顧客がやりたいこと」に直行する。
//
// ## 実害（本番実機、2026-08-01 オーナー操作）
//
// 「⭐⭐ プレミアムへ」を押すと Stripe Customer Portal の**ホーム**に着き、
// 並ぶのは「サブスクリプションを更新」「サブスクリプションをキャンセル」。
// 顧客は「更新 = 支払い方法の更新 / 継続」と読むため**プラン変更に到達しない**。
// オーナー自身が最初に到達できなかった。
//
// **解約側はさらに悪い。** 解約理由フォームを埋めきった直後に portal ホームへ放り出され、
// そこから自分で「サブスクリプションをキャンセル」を探すことになる（特商法の解約導線の実効性）。
//
// ## 何を固定するか
//
// Stripe portal の**ボタン文言は変更できない**（Branding は色・ロゴ・事業者名のみ）。
// したがってアプリ側で `flow_data` を渡し、目的のフローへ直行させるのが唯一の手段。
//
// **CI では着地を検証できない**（flow の描画は Stripe 側、cognito-dev レーンの Stripe は無効 #4161）。
// ユニットで担保できるのは **`create()` に渡した引数**までなので、そこを固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockPortalCreate = vi.fn();

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
	TRIAL_PERIOD_DAYS: 7,
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));
vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));
vi.mock('$lib/server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyDiscord: vi.fn(),
	notifyIncident: vi.fn(),
}));

import { createPortalSession } from '../../../src/lib/server/services/stripe-service';

const RETURN_URL = 'https://app.example/admin/subscription';

function tenant(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: 't-test',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: 'sub_123',
		status: 'active',
		plan: 'monthly',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });
});

/** 直近の create() 引数。 */
function lastArgs(): Record<string, unknown> {
	return mockPortalCreate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('#4166 AC1 portal は「顧客がやりたいこと」へ直行する', () => {
	it('subscription_update: プラン変更フローへ直行し、対象 subscription を渡す', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_update' });

		const args = lastArgs();
		expect(args.flow_data, 'flow_data が無いと portal ホームに着く (#4166 の実害そのもの)').toEqual(
			expect.objectContaining({
				type: 'subscription_update',
				subscription_update: { subscription: 'sub_123' },
			}),
		);
	});

	it('subscription_cancel: 解約フローへ直行し、対象 subscription を渡す', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_cancel' });

		expect(lastArgs().flow_data).toEqual(
			expect.objectContaining({
				type: 'subscription_cancel',
				subscription_cancel: { subscription: 'sub_123' },
			}),
		);
	});

	// AC5: 汎用導線 (請求書確認 / 支払い方法変更) の入口を潰さない
	it('home: flow_data を付けない（汎用導線は portal ホームのまま）', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'home' });

		expect(
			lastArgs().flow_data,
			'汎用導線に flow を付けると請求書・支払い方法の入口が消える',
		).toBeUndefined();
	});

	it('flow 未指定は home 相当（既存呼び出しの挙動を変えない）', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL);

		expect(lastArgs().flow_data).toBeUndefined();
	});
});

describe('#4166 AC3 フロー完了後はアプリへ戻る', () => {
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: after_completion で return_url へ redirect する', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind });

		const flow = lastArgs().flow_data as Record<string, unknown>;
		expect(
			flow.after_completion,
			'省略時の挙動は公式ドキュメントに明記が無く、portal に留まる。明示指定する',
		).toEqual({ type: 'redirect', redirect: { return_url: RETURN_URL } });
	});

	it('途中離脱できるよう、トップレベルの return_url は常に渡す', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		await createPortalSession('t-test', RETURN_URL, { kind: 'subscription_cancel' });

		expect(lastArgs().return_url).toBe(RETURN_URL);
	});
});

describe('#4270 Stripe が flow を拒否したら home で作り直す', () => {
	// flow は Stripe Dashboard の Portal 設定 (更新オプションの価格 / 解約の許可) が生きている
	// ことを前提にする。設定がずれた瞬間に **portal に一切入れなくなる** のは、直行できないより悪い。
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: 1 回目が失敗しても flow 無しで作り直して URL を返す', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockPortalCreate
			.mockRejectedValueOnce(new Error('No such price / flow not configured'))
			.mockResolvedValueOnce({ url: 'https://billing.stripe.com/home_1' });

		const result = await createPortalSession('t-test', RETURN_URL, { kind });

		expect(mockPortalCreate).toHaveBeenCalledTimes(2);
		expect(
			lastArgs().flow_data,
			'作り直しに flow を残すと同じ理由でまた落ち、portal に入れないままになる',
		).toBeUndefined();
		expect(lastArgs().return_url).toBe(RETURN_URL);
		expect(result).toEqual({ url: 'https://billing.stripe.com/home_1', flowFallback: true });
	});

	it('倒れたことを呼び出し元に伝える (黙って portal ホームへ落とさないため)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockPortalCreate
			.mockRejectedValueOnce(new Error('flow rejected'))
			.mockResolvedValueOnce({ url: 'https://billing.stripe.com/home_2' });

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_cancel',
		});

		expect(
			'flowFallback' in result && result.flowFallback,
			'true でないと画面が「予期しない場所に着いた」ことに気づけず案内を出せない',
		).toBe(true);
	});

	it('成功したときは flowFallback を立てない (通常の直行と区別する)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());

		const result = await createPortalSession('t-test', RETURN_URL, {
			kind: 'subscription_update',
		});

		expect(result).toEqual({ url: 'https://billing.stripe.com/session_1' });
	});

	it('作り直しも失敗したら握り潰さず投げる (portal に入れない事実を成功として返さない)', async () => {
		mockFindTenantById.mockResolvedValue(tenant());
		mockPortalCreate.mockRejectedValue(new Error('Stripe API down'));

		await expect(
			createPortalSession('t-test', RETURN_URL, { kind: 'subscription_update' }),
		).rejects.toThrow('Stripe API down');
	});
});

describe('#4166 AC2 subscription を持たないなら home にフォールバックする', () => {
	// flow を付けたまま subscription なしで投げると Stripe が 400 を返し、
	// **導線ごと死ぬ**（顧客は何を押しても portal に入れない）。
	it.each([
		'subscription_update',
		'subscription_cancel',
	] as const)('%s: stripeSubscriptionId が無ければ flow を付けない', async (kind) => {
		mockFindTenantById.mockResolvedValue(tenant({ stripeSubscriptionId: null }));

		const result = await createPortalSession('t-test', RETURN_URL, { kind });

		expect(
			lastArgs().flow_data,
			'subscription 無しで flow を付けると Stripe が 400 を返し導線ごと死ぬ',
		).toBeUndefined();
		// **落とさずに portal へは入れる**こと（fallback の意味）
		expect(result).toEqual({ url: 'https://billing.stripe.com/session_1' });
	});
});

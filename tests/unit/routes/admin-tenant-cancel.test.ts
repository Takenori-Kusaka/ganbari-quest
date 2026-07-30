// tests/unit/routes/admin-tenant-cancel.test.ts
// #3991 (#3986 統合): admin/tenant/cancel と admin/tenant/reactivate の契約テスト
//
// 案 A (期末解約、FR-1 / NFR-2、PO 確定 2026-05-27):
//   - cancel は Stripe に `cancel_at_period_end=true` を予約するだけで **DB を書かない**
//   - reactivate は Stripe の `cancel_at_period_end` を唯一の判定材料にする
//
// 旧実装 (#784) の即時キャンセル + `status=grace_period` 書き込みが同時に壊していたもの:
//   1. 即時キャンセル直後の `customer.subscription.deleted` が `grace_period` を `suspended` に
//      上書きするため、約束した取り消し導線が 1 度も機能しない
//   2. `grace_period` は支払い失敗の dunning でも書かれる同じ値なので、dunning 中のテナントが
//      reactivate を通過して未払いのまま ACTIVE に戻せる (#3986)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantById = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockScheduleCancellation = vi.fn();
const mockResumeSubscription = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantById: mockFindTenantById,
			updateTenantStripe: mockUpdateTenantStripe,
		},
	}),
}));

vi.mock('$lib/server/services/stripe-service', () => ({
	scheduleCancellationAtPeriodEnd: (...args: unknown[]) => mockScheduleCancellation(...args),
	resumeSubscription: (...args: unknown[]) => mockResumeSubscription(...args),
}));

const mockSendCancellationEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/services/email-service', () => ({
	sendCancellationEmail: (...args: unknown[]) => mockSendCancellationEmail(...args),
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyCancellation: vi.fn().mockResolvedValue(undefined),
	notifyCancellationReverted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks
const { POST: cancelPOST } = await import('../../../src/routes/api/v1/admin/tenant/cancel/+server');
const { POST: reactivatePOST } = await import(
	'../../../src/routes/api/v1/admin/tenant/reactivate/+server'
);

// ---------- Helpers ----------

type TenantOverrides = {
	status?: 'active' | 'suspended' | 'grace_period' | 'terminated';
	stripeSubscriptionId?: string | undefined;
	stripeCustomerId?: string | undefined;
	plan?: 'monthly' | 'family-monthly' | undefined;
};

function makeTenant(overrides: TenantOverrides = {}) {
	return {
		tenantId: 't-test',
		name: 'テスト家族',
		ownerId: 'u-owner',
		status: 'active',
		plan: 'monthly',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: 'sub_123',
		trialUsedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

const PERIOD_END = '2026-02-01T00:00:00.000Z';

function state(cancelAtPeriodEnd: boolean) {
	return { subscriptionId: 'sub_123', cancelAtPeriodEnd, currentPeriodEnd: PERIOD_END };
}

type Role = 'owner' | 'parent' | 'child';

function makeEvent(role: Role = 'owner', tenantId = 't-test') {
	return {
		locals: {
			context: { tenantId, role },
			identity: { type: 'cognito', userId: 'u-owner', email: 'owner@example.com' },
		},
	} as unknown as Parameters<typeof cancelPOST>[0];
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTenantById.mockResolvedValue(makeTenant());
	mockUpdateTenantStripe.mockResolvedValue(undefined);
	mockScheduleCancellation.mockResolvedValue({ status: 'scheduled', state: state(true) });
	mockResumeSubscription.mockResolvedValue({ status: 'resumed', state: state(false) });
	mockSendCancellationEmail.mockResolvedValue(undefined);
});

// ==========================================================
// cancel
// ==========================================================

describe('POST /api/v1/admin/tenant/cancel (#3991 期末解約)', () => {
	it('owner 以外は 403', async () => {
		const res = (await cancelPOST(makeEvent('parent'))) as Response;
		expect(res.status).toBe(403);
		expect(mockScheduleCancellation).not.toHaveBeenCalled();
	});

	it('テナントが存在しない場合 404', async () => {
		mockFindTenantById.mockResolvedValueOnce(undefined);
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(404);
		expect(mockScheduleCancellation).not.toHaveBeenCalled();
	});

	it('既に terminated なら 409', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeTenant({ status: 'terminated' }));
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockScheduleCancellation).not.toHaveBeenCalled();
	});

	it('期末解約を予約し、DB の契約状態は一切書き換えない (status は ACTIVE のまま)', async () => {
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(200);
		const body = await jsonOf(res);
		expect(body.success).toBe(true);
		expect(body.cancelAtPeriodEnd).toBe(true);
		expect(body.periodEndAt).toBe(PERIOD_END);

		expect(mockScheduleCancellation).toHaveBeenCalledWith('t-test');
		// FR-1 / NFR-2: 「解約申請中」の SSOT は Stripe。DB の status / planExpiresAt を書かない
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('解約メールには請求期間の終了日を渡す (30 日固定の猶予ではない)', async () => {
		await cancelPOST(makeEvent());
		const [, periodEndDate] = mockSendCancellationEmail.mock.calls[0] as [string, string];
		// 2026-02-01T00:00:00Z = JST 2026/2/1 09:00
		expect(periodEndDate).toBe(
			new Date(PERIOD_END).toLocaleDateString('ja-JP', {
				timeZone: 'Asia/Tokyo',
			}),
		);
	});

	it('既に期末解約を予約済みなら 409 (Stripe 状態を二重に書き換えない)', async () => {
		mockScheduleCancellation.mockResolvedValueOnce({
			status: 'already_scheduled',
			state: state(true),
		});
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('契約が無い場合は 409 (旧実装のように grace_period へ落とさない)', async () => {
		mockScheduleCancellation.mockResolvedValueOnce({ status: 'not_subscribed' });
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('支払い失敗で dunning 中 (grace_period) でも解約できる', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeTenant({ status: 'grace_period' }));
		const res = (await cancelPOST(makeEvent())) as Response;
		expect(res.status).toBe(200);
		expect(mockScheduleCancellation).toHaveBeenCalledWith('t-test');
	});

	it('Stripe 呼び出しが失敗した場合は 500 を投げ、DB は更新されない', async () => {
		mockScheduleCancellation.mockRejectedValueOnce(new Error('Stripe API down'));
		await expect(cancelPOST(makeEvent())).rejects.toMatchObject({ status: 500 });
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});
});

// ==========================================================
// reactivate
// ==========================================================

describe('POST /api/v1/admin/tenant/reactivate (#3991 / #3986)', () => {
	it('owner 以外は 403', async () => {
		const res = (await reactivatePOST(makeEvent('parent'))) as Response;
		expect(res.status).toBe(403);
		expect(mockResumeSubscription).not.toHaveBeenCalled();
	});

	it('テナントが存在しない場合 404', async () => {
		mockFindTenantById.mockResolvedValueOnce(undefined);
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(404);
	});

	it('期末解約の予約を取り消せる (#784 が約束した取り消し導線が機能する)', async () => {
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(200);
		const body = await jsonOf(res);
		expect(body.success).toBe(true);
		expect(body.cancelAtPeriodEnd).toBe(false);
		expect(mockResumeSubscription).toHaveBeenCalledWith('t-test');
		// 契約は生きたままなので DB を書き換える必要がない
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('#3986: 支払い失敗で dunning 中のテナントは 409 で弾かれ ACTIVE に戻らない', async () => {
		mockFindTenantById.mockResolvedValueOnce(makeTenant({ status: 'grace_period' }));
		mockResumeSubscription.mockResolvedValueOnce({
			status: 'not_scheduled',
			state: state(false),
		});
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(await jsonOf(res)).toMatchObject({ error: '解約手続き中ではありません' });
		// 未払いのまま有料機能を復活させない
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('解約申請していない ACTIVE テナントも 409', async () => {
		mockResumeSubscription.mockResolvedValueOnce({
			status: 'not_scheduled',
			state: state(false),
		});
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('期末到来後 (契約消滅済) は 409 + redirectTo=/pricing で再購読へ誘導する', async () => {
		mockFindTenantById.mockResolvedValueOnce(
			makeTenant({ status: 'suspended', stripeSubscriptionId: undefined }),
		);
		mockResumeSubscription.mockResolvedValueOnce({ status: 'not_subscribed' });
		const res = (await reactivatePOST(makeEvent())) as Response;
		expect(res.status).toBe(409);
		const body = await jsonOf(res);
		expect(body.reason).toBe('subscription_cancelled');
		expect(body.redirectTo).toBe('/pricing');
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});

	it('Stripe 呼び出しが失敗した場合は 500 を投げる', async () => {
		mockResumeSubscription.mockRejectedValueOnce(new Error('Stripe API down'));
		await expect(reactivatePOST(makeEvent())).rejects.toMatchObject({ status: 500 });
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
	});
});

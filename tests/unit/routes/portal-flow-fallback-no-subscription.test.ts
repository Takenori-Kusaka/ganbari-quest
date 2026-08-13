// tests/unit/routes/portal-flow-fallback-no-subscription.test.ts
// #4537 — subscription を持たない顧客が「解約手続きへ進む」で portal ホームに放り出されない。
//
// ## なぜ route ごとの単体テストでは足りないか
//
// `flowFallback` は **service が立て、route が読む** 2 層の契約である。既存の route テストは
// `createPortalSession` をモックして `{ url, flowFallback: true }` を注入しているため、
// **service がその値を実際に立てるか**は検証していない。逆に service テストは
// **route が本当に自画面へ戻すか**を検証していない。
//
// 契約が切れるのは 2 層の継ぎ目なので、本 test は **stripe-service を実物のまま** 通し、
// 「DB に stripeSubscriptionId が無い」という入力だけを与えて、離反経路と卒業経路の
// **両方**が自画面へ戻すことを端から端まで固定する。
//
// ## 実害 (#4498 と同じ結果)
//
// stripeCustomerId はあるが stripeSubscriptionId が null の顧客 (解約済みで Customer だけ残る /
// webhook 取りこぼしによるドリフト) は、flow_data 無しで session が作れてしまうため
// Stripe API は成功する。旧実装はこれを「直行できた」として素通しし、顧客は解約フローに
// 到達しないまま portal ホームに着いた。ドリフト側では **押したのに課金が続く**。

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 action の型を最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildPortalFallbackLocation,
	PORTAL_FALLBACK_CONTEXT,
	PORTAL_FALLBACK_REASON,
} from '$lib/domain/constants/stripe-portal';

const mockFindTenantById = vi.fn();
const mockPortalCreate = vi.fn();
const mockGetLicenseInfo = vi.fn();
const mockSubmitCancellationReason = vi.fn();
const mockRecordGraduationConsent = vi.fn();

// **stripe-service はモックしない** (本 test の主眼が service ↔ route の継ぎ目のため)。
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantById: mockFindTenantById },
		child: { findAllChildren: async () => [] },
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
vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyDiscord: vi.fn(),
	notifyIncident: vi.fn(),
}));

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));
vi.mock('$lib/server/services/cancellation-service', () => ({
	submitCancellationReason: (...args: unknown[]) => mockSubmitCancellationReason(...args),
}));
vi.mock('$lib/server/services/graduation-service', async () => {
	const actual = (await vi.importActual('$lib/server/services/graduation-service')) as Record<
		string,
		unknown
	>;
	return {
		...actual,
		recordGraduationConsent: (...args: unknown[]) => mockRecordGraduationConsent(...args),
	};
});
vi.mock('$lib/server/db/point-repo', () => ({ getBalance: async () => 0 }));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

import { actions as cancelActionsRaw } from '../../../src/routes/(parent)/admin/subscription/cancel/+page.server';
import { actions as graduationActionsRaw } from '../../../src/routes/(parent)/admin/subscription/cancel/graduation/+page.server';

const cancelAction = (cancelActionsRaw as any).default as (...args: unknown[]) => any;
const graduationAction = (graduationActionsRaw as any).default as (...args: unknown[]) => any;

const LOCALS = { context: { tenantId: 'tenant-1' } };
// #4548: 戻り先は**理由つき**。理由が落ちると戻った先は再試行を促す文言しか出せず、
// 何度押しても直らない顧客が同じ画面をぐるぐる回る (出口が無い) 状態に戻る。
const EXPECTED_FALLBACK_LOCATION = buildPortalFallbackLocation(
	PORTAL_FALLBACK_CONTEXT.CANCEL,
	PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION,
);

/** Stripe Customer は持つが subscription を持たないテナント (本 test の入力そのもの)。 */
function tenantWithoutSubscription() {
	return {
		tenantId: 'tenant-1',
		stripeCustomerId: 'cus_123',
		stripeSubscriptionId: null,
		status: 'active',
		plan: 'monthly',
	};
}

async function catchThrown(run: () => Promise<unknown>): Promise<any> {
	try {
		return { returned: await run() };
	} catch (e) {
		return e;
	}
}

function formRequest(form: Record<string, string>): Request {
	return new Request('http://localhost/admin/subscription/cancel', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form).toString(),
	});
}

/** 離反 (churn) を選んで解約理由を送信する = 通常解約経路。 */
function runCancelAction() {
	return catchThrown(() =>
		cancelAction({
			request: formRequest({ category: 'churn', freeText: '' }),
			locals: LOCALS,
			url: new URL('https://app.example/admin/subscription/cancel'),
		}),
	);
}

/** 「卒業を完了する」を押す = 卒業経路 (#4498 で portal 到達を実装した側)。 */
function runGraduationAction() {
	return catchThrown(() =>
		graduationAction({
			request: formRequest({
				consented: 'on',
				nickname: 'たろう家',
				message: '',
				totalPoints: '100',
				usagePeriodDays: '30',
			}),
			locals: LOCALS,
			url: new URL('https://app.example/admin/subscription/cancel/graduation'),
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/home_1' });
	mockFindTenantById.mockResolvedValue(tenantWithoutSubscription());
	mockSubmitCancellationReason.mockResolvedValue({ ok: true });
	mockGetLicenseInfo.mockResolvedValue({
		plan: 'standard_monthly',
		createdAt: new Date().toISOString(),
		stripeSubscriptionId: null,
		stripeCustomerId: 'cus_123',
	});
	mockRecordGraduationConsent.mockResolvedValue({
		ok: true,
		record: {
			id: '1',
			tenantId: 'tenant-1',
			nickname: 'たろう家',
			consented: true,
			userPoints: 100,
			usagePeriodDays: 30,
			message: null,
			consentedAt: new Date().toISOString(),
		},
	});
});

describe('#4537 subscription が無い顧客を portal ホームへ無言で飛ばさない (service ↔ route 通し)', () => {
	// 「両方の経路が同じ扱いになること」= AC3。片方だけ直しても気づけないよう 1 つの表で回す。
	it.each([
		['通常解約 (離反)', runCancelAction],
		['卒業', runGraduationAction],
	] as const)('%s: portal URL へ飛ばさず、手続きを続けられる自画面へ戻す', async (_name, run) => {
		const thrown = await run();

		expect(thrown.status).toBe(303);
		expect(
			thrown.location,
			'ここで portal URL へ飛ばすと、顧客は説明のないまま portal ホームに着く',
		).not.toBe('https://billing.stripe.com/home_1');
		expect(thrown.location).toBe(EXPECTED_FALLBACK_LOCATION);
	});

	it.each([
		['通常解約 (離反)', runCancelAction],
		['卒業', runGraduationAction],
	] as const)('%s: subscription があるときは従来どおり portal へ直行する (回帰防止)', async (_name, run) => {
		mockFindTenantById.mockResolvedValue({
			...tenantWithoutSubscription(),
			stripeSubscriptionId: 'sub_123',
		});
		mockGetLicenseInfo.mockResolvedValue({
			plan: 'standard_monthly',
			createdAt: new Date().toISOString(),
			stripeSubscriptionId: 'sub_123',
			stripeCustomerId: 'cus_123',
		});
		mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });

		const thrown = await run();

		expect(thrown.status).toBe(303);
		expect(thrown.location).toBe('https://billing.stripe.com/session_1');
	});

	it.each([
		['通常解約 (離反)', runCancelAction],
		['卒業', runGraduationAction],
	] as const)('%s: 解約フローを要求したこと自体は変えない (flow_data は組めないので付かない)', async (_name, run) => {
		await run();

		expect(mockPortalCreate).toHaveBeenCalledTimes(1);
		expect(
			mockPortalCreate.mock.calls.at(0)?.[0]?.flow_data,
			'subscription 無しで flow を付けると Stripe が 400 を返し導線ごと死ぬ',
		).toBeUndefined();
	});
});

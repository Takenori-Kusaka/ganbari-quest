// tests/unit/routes/subscription-cancel-portal-dead-end.test.ts
// #4329 ① — 解約が**無言で失敗する**経路を塞ぐ。
//
// ## 実害
//
// 解約理由フォームを最後まで埋めた顧客は、portal 作成に失敗すると何も知らされないまま
// thanks ページ (「ご回答ありがとうございました」) に落ちていた。thanks の CTA は
// 「Stripe 請求管理ページで解約を完了する」と名乗りながら自アプリのプラン画面へ戻すだけ。
// **顧客は解約したつもりで課金され続ける**（特商法の解約導線の実効性に接続する）。
//
// ## 何を固定するか
//
// - 失敗を成功 (素の thanks) として見せない = 失敗したことが画面に届く signal を必ず載せる
// - 失敗を運用側から観測できる (logger)
// - 「Stripe へ行く」と名乗る CTA が実際に Stripe へ行く (thanks の openPortal action)
// - 成功経路は従来どおり (portal URL への 303、flow 拒否時は #4270 の自画面戻し)

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 load/action の型を最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PORTAL_FALLBACK_REASON } from '$lib/domain/constants/stripe-portal';
import { PORTAL_UNAVAILABLE_PARAM } from '../../../src/lib/domain/constants/stripe-portal';

const mockGetLicenseInfo = vi.fn();
const mockSubmitCancellationReason = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockIsStripeEnabled = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));

vi.mock('$lib/server/services/cancellation-service', () => ({
	submitCancellationReason: (...args: unknown[]) => mockSubmitCancellationReason(...args),
}));

vi.mock('$lib/server/services/stripe-service', () => ({
	createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: (...args: unknown[]) => mockIsStripeEnabled(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => mockLoggerError(...args) },
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

import { actions as cancelActionsRaw } from '../../../src/routes/(parent)/admin/subscription/cancel/+page.server';
import {
	actions as thanksActionsRaw,
	load as thanksLoadRaw,
} from '../../../src/routes/(parent)/admin/subscription/cancel/thanks/+page.server';

const cancelAction = (cancelActionsRaw as any).default as (...args: unknown[]) => any;
const thanksActions = thanksActionsRaw as unknown as {
	openPortal: (...args: unknown[]) => any;
};
const thanksLoad = thanksLoadRaw as unknown as (...args: unknown[]) => any;

const LOCALS = { context: { tenantId: 'tenant-1' } };
const PAGE_URL = new URL('https://app.example/admin/subscription/cancel');

function buildCancelEvent() {
	const formData = new FormData();
	formData.set('category', 'churn');
	formData.set('freeText', '');
	return {
		request: { formData: async () => formData },
		locals: LOCALS,
		url: PAGE_URL,
	};
}

/** action は redirect を throw するため、その中身を取り出す */
async function catchThrown(run: () => Promise<unknown>): Promise<any> {
	try {
		const returned = await run();
		return { returned };
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
	mockSubmitCancellationReason.mockResolvedValue({ ok: true });
	mockGetLicenseInfo.mockResolvedValue({
		plan: 'standard_monthly',
		stripeSubscriptionId: 'sub_123',
		stripeCustomerId: 'cus_123',
	});
});

describe('解約 action: portal を作れなかったとき (#4329 AC1 / AC4)', () => {
	it('素の thanks ページへ無言で落とさない（失敗した signal を必ず載せる）', async () => {
		mockCreatePortalSession.mockResolvedValue({ error: 'PORTAL_CREATE_FAILED' });

		const thrown = await catchThrown(() => cancelAction(buildCancelEvent()));

		expect(thrown.status).toBe(303);
		expect(thrown.location).not.toBe('/admin/subscription/cancel/thanks');
		expect(thrown.location).toContain(`${PORTAL_UNAVAILABLE_PARAM}=1`);
	});

	it('運用側が気づけるよう logger.error に残す（顧客も運営も気づけない状態を断つ）', async () => {
		mockCreatePortalSession.mockResolvedValue({ error: 'PORTAL_CREATE_FAILED' });

		await catchThrown(() => cancelAction(buildCancelEvent()));

		expect(mockLoggerError).toHaveBeenCalledTimes(1);
		expect(String(mockLoggerError.mock.calls.at(0)?.[0])).toContain('tenant-1');
	});

	it('成功経路は従来どおり portal URL へ 303 する（回帰防止）', async () => {
		mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });

		const thrown = await catchThrown(() => cancelAction(buildCancelEvent()));

		expect(thrown.status).toBe(303);
		expect(thrown.location).toBe('https://billing.stripe.com/session_1');
	});

	// #4548: 理由も URL に載せる。載せないと戻り先は一時障害の文言 (再試行) しか出せず、
	// 何度押しても直らない顧客に「もう一度お試しください」を出し続ける。
	it.each([
		[PORTAL_FALLBACK_REASON.FLOW_REJECTED],
		[PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION],
	])('flow 直行できなかったとき (理由 %s) は理由つきで自画面へ戻す', async (reason) => {
		mockCreatePortalSession.mockResolvedValue({
			url: 'https://billing.stripe.com/home_1',
			flowFallback: reason,
		});

		const thrown = await catchThrown(() => cancelAction(buildCancelEvent()));

		expect(thrown.location).toBe(
			`/admin/subscription?portalFallback=cancel&portalFallbackReason=${reason}`,
		);
	});
});

describe('thanks load: 手続きが残っていることを画面に伝える (#4329 AC1)', () => {
	function buildLoadEvent(search: string) {
		return {
			locals: LOCALS,
			url: new URL(`https://app.example/admin/subscription/cancel/thanks${search}`),
		};
	}

	it('解約 action からの signal が付いていれば portalUnavailable=true', async () => {
		const data = await thanksLoad(buildLoadEvent(`?${PORTAL_UNAVAILABLE_PARAM}=1`));

		expect(data.portalUnavailable).toBe(true);
	});

	it('signal が落ちても契約が生きていれば portalUnavailable=true（再読み込みで誤解を作らない）', async () => {
		const data = await thanksLoad(buildLoadEvent(''));

		expect(data.portalUnavailable).toBe(true);
	});

	it('load の戻り値がシリアライズ可能である（関数を返すと画面ごと 500 になる）', async () => {
		// #4329: 旧実装は `labels: CANCELLATION_LABELS` を返しており、この定数が持つ関数
		// (`freeTextHint`) が SvelteKit のシリアライズを落として **この画面は常に 500** だった。
		// 解約導線の最後で顧客がエラーページに落ちる = 何も伝わらない。
		const data = await thanksLoad(buildLoadEvent(''));

		expect(() => structuredClone(data)).not.toThrow();
	});

	it('無料プラン（Stripe 契約なし）では出さない', async () => {
		mockGetLicenseInfo.mockResolvedValue({ plan: 'free' });

		const data = await thanksLoad(buildLoadEvent(''));

		expect(data.portalUnavailable).toBe(false);
	});
});

describe('thanks openPortal action: Stripe へ行くと名乗る CTA が実際に Stripe へ行く (#4329 AC2 / AC3)', () => {
	function buildActionEvent() {
		return {
			locals: LOCALS,
			url: new URL('https://app.example/admin/subscription/cancel/thanks'),
		};
	}

	it('portal を作れたら Stripe の URL へ 303 する', async () => {
		mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session_2' });

		const thrown = await catchThrown(() => thanksActions.openPortal(buildActionEvent()));

		expect(thrown.status).toBe(303);
		expect(thrown.location).toBe('https://billing.stripe.com/session_2');
	});

	it('解約フローで作る（portal ホームに放り出さない）', async () => {
		mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session_2' });

		await catchThrown(() => thanksActions.openPortal(buildActionEvent()));

		expect(mockCreatePortalSession).toHaveBeenCalledWith(
			'tenant-1',
			expect.stringContaining('/admin/subscription'),
			{ kind: 'subscription_cancel' },
		);
	});

	it('再試行も失敗したら失敗として返す（内部の失敗コードは載せない、ADR-0062）', async () => {
		mockCreatePortalSession.mockResolvedValue({ error: 'PORTAL_CREATE_FAILED' });

		const result = await catchThrown(() => thanksActions.openPortal(buildActionEvent()));

		expect(result.returned.status).toBe(503);
		expect(result.returned.data).toEqual({ portalRetryFailed: true });
		expect(JSON.stringify(result.returned.data)).not.toContain('PORTAL_CREATE_FAILED');
		expect(mockLoggerError).toHaveBeenCalledTimes(1);
	});
});

// tests/unit/routes/subscription-cancel-graduation.test.ts
// 卒業フロー専用ページ load + form action テスト (#1603 / ADR-0023 §3.8 / §5 I10)
//
// テスト観点:
// - load: 残ポイント合計 + 利用日数 + plan 情報を返す
// - load: child が居ない / point 取得失敗時も totalPoints=0 で表示できる
// - action: nickname 必須 (consented=true 時)
// - action: nickname 30 文字超でエラー
// - action: 課金プラン → Customer Portal の解約フローへ直行 (#4498)
// - action: portal を作れなかった場合 → thanks?portalUnavailable=1 (#4498 / #4329 と同型)
// - action: 無料プラン → /admin/subscription/cancel/thanks にリダイレクト
//
// #4498: 旧実装は課金プランでも `createPortalSession` を呼ばず `/admin/subscription` へ
// 戻すだけだった。送信ボタンは「卒業を完了する」なので顧客は手続き完了と誤認し、
// **課金が継続する**。旧テストはその挙動 (`location: '/admin/subscription'`) を
// 正解として固定していたため、テストごと是正する。

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 load/action の型を最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PORTAL_FALLBACK_CONTEXT,
	PORTAL_FALLBACK_PARAM,
	PORTAL_UNAVAILABLE_PARAM,
} from '$lib/domain/constants/stripe-portal';
import type { ChildId } from '$lib/domain/ids';

const mockFindAllChildren = vi.fn();
const mockGetBalance = vi.fn();
const mockGetLicenseInfo = vi.fn();
const mockRecordGraduationConsent = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockIsStripeEnabled = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('$lib/server/services/stripe-service', () => ({
	createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: (...args: unknown[]) => mockIsStripeEnabled(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => mockLoggerError(...args) },
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
	}),
}));

vi.mock('$lib/server/db/point-repo', () => ({
	getBalance: (...args: unknown[]) => mockGetBalance(...args),
}));

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
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

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

type AnyAction = (...args: unknown[]) => any;
type AnyLoad = (...args: unknown[]) => any;

import {
	actions as actionsRaw,
	load as loadRaw,
} from '../../../src/routes/(parent)/admin/subscription/cancel/graduation/+page.server';

const load = loadRaw as unknown as AnyLoad;
const actions = actionsRaw as unknown as { default: AnyAction };

beforeEach(() => {
	vi.clearAllMocks();
	mockIsStripeEnabled.mockReturnValue(true);
});

const PAGE_URL = new URL('https://app.example/admin/subscription/cancel/graduation');

function buildLocals(tenantId = 'tenant-1') {
	return { context: { tenantId } };
}

function buildLoadEvent(tenantId = 'tenant-1') {
	return {
		locals: buildLocals(tenantId),
	};
}

function buildActionRequest(form: Record<string, string>): Request {
	const body = new URLSearchParams(form);
	return new Request('http://localhost/admin/subscription/cancel/graduation', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});
}

/** action は redirect を throw するため、その中身を取り出す */
async function catchThrown(run: () => Promise<unknown>): Promise<any> {
	try {
		return { returned: await run() };
	} catch (e) {
		return e;
	}
}

/** 有料プラン (Stripe Customer あり) で卒業を送信したときの action 実行 */
async function runPaidGraduationAction() {
	mockGetLicenseInfo.mockResolvedValue({
		createdAt: new Date().toISOString(),
		stripeSubscriptionId: 'sub_123',
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

	return catchThrown(() =>
		actions.default({
			request: buildActionRequest({
				consented: 'on',
				nickname: 'たろう家',
				message: '',
				totalPoints: '100',
				usagePeriodDays: '30',
			}),
			locals: buildLocals(),
			url: PAGE_URL,
		}),
	);
}

describe('billing-cancel-graduation +page.server.ts', () => {
	describe('load', () => {
		it('全子供のポイント合計を計算して返す', async () => {
			mockFindAllChildren.mockResolvedValue([
				{ id: '1', nickname: 'a' },
				{ id: '2', nickname: 'b' },
			]);
			mockGetBalance.mockImplementation(async (childId: ChildId) => {
				if (childId === '1') return 500;
				if (childId === '2') return 800;
				return 0;
			});
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
				stripeSubscriptionId: 'sub_123',
				stripeCustomerId: 'cus_123',
			});

			const result = await load(buildLoadEvent());
			expect(result.totalPoints).toBe(1300);
			expect(result.yenAmount).toBe(1300);
			expect(result.usagePeriodDays).toBeGreaterThanOrEqual(9);
			expect(result.usagePeriodDays).toBeLessThanOrEqual(10);
			expect(result.isPaidPlan).toBe(true);
			expect(result.hasStripeCustomer).toBe(true);
			// #4498: 送信ボタンの名乗りを action の分岐と一致させるための材料
			expect(result.stripeEnabled).toBe(true);
			expect(result.nicknameMaxLength).toBe(30);
			expect(result.messageMaxLength).toBe(500);
		});

		it('子供が居ない場合 totalPoints=0', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});

			const result = await load(buildLoadEvent());
			expect(result.totalPoints).toBe(0);
			expect(result.yenAmount).toBe(0);
			expect(result.isPaidPlan).toBe(false);
			expect(result.hasStripeCustomer).toBe(false);
		});

		it('getBalance 失敗時も合計 0 でエラーにせずに返す', async () => {
			mockFindAllChildren.mockResolvedValue([{ id: '1', nickname: 'a' }]);
			mockGetBalance.mockRejectedValue(new Error('balance fetch failed'));
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});

			const result = await load(buildLoadEvent());
			expect(result.totalPoints).toBe(0);
		});

		it('license が null でも usagePeriodDays=0 で返す', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockGetLicenseInfo.mockResolvedValue(null);

			const result = await load(buildLoadEvent());
			expect(result.usagePeriodDays).toBe(0);
			expect(result.isPaidPlan).toBe(false);
		});
	});

	describe('action default', () => {
		it('承諾ありで nickname 必須エラー → 400 fail', async () => {
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});
			mockRecordGraduationConsent.mockResolvedValue({
				ok: false,
				error: 'NICKNAME_REQUIRED',
			});

			const request = buildActionRequest({
				consented: 'on',
				nickname: '',
				message: '',
				totalPoints: '0',
				usagePeriodDays: '0',
			});

			const result = await actions.default({
				request,
				locals: buildLocals(),
				url: PAGE_URL,
			});

			expect(result).toMatchObject({
				status: 400,
				data: { errorKey: 'errorNicknameRequired' },
			});
		});

		it('nickname 30 文字超で TOO_LONG エラー', async () => {
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});
			mockRecordGraduationConsent.mockResolvedValue({
				ok: false,
				error: 'NICKNAME_TOO_LONG',
			});

			const request = buildActionRequest({
				consented: 'on',
				nickname: 'a'.repeat(50),
				message: '',
				totalPoints: '0',
				usagePeriodDays: '0',
			});

			const result = await actions.default({
				request,
				locals: buildLocals(),
				url: PAGE_URL,
			});

			expect(result).toMatchObject({
				status: 400,
				data: { errorKey: 'errorNicknameTooLong' },
			});
		});

		it('無料プランでは portal を作らない（既存挙動の回帰防止）', async () => {
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});
			mockRecordGraduationConsent.mockResolvedValue({ ok: true, record: {} });

			await catchThrown(() =>
				actions.default({
					request: buildActionRequest({
						nickname: '',
						message: '',
						totalPoints: '0',
						usagePeriodDays: '0',
					}),
					locals: buildLocals(),
					url: PAGE_URL,
				}),
			);

			expect(mockCreatePortalSession).not.toHaveBeenCalled();
		});

		it('無料プランは /admin/subscription/cancel/thanks に redirect', async () => {
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});
			mockRecordGraduationConsent.mockResolvedValue({
				ok: true,
				record: {
					id: '1',
					tenantId: 'tenant-1',
					nickname: '匿名の卒業生',
					consented: false,
					userPoints: 0,
					usagePeriodDays: 0,
					message: null,
					consentedAt: new Date().toISOString(),
				},
			});

			const request = buildActionRequest({
				nickname: '',
				message: '',
				totalPoints: '0',
				usagePeriodDays: '0',
			});

			await expect(
				actions.default({
					request,
					locals: buildLocals(),
					url: PAGE_URL,
				}),
			).rejects.toMatchObject({
				status: 303,
				location: '/admin/subscription/cancel/thanks',
			});
		});
	});

	// #4498: 卒業経路の解約が Stripe に到達しない (課金が続く) 状態を塞ぐ。
	// 離反/中断経路 (`cancel/+page.server.ts`、#4166 / #4270 / #4329) と同型であることを固定する。
	describe('action default: 課金プランは Customer Portal の解約フローへ直行する (#4498)', () => {
		it('createPortalSession を解約フロー (subscription_cancel) で呼ぶ', async () => {
			mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });

			await runPaidGraduationAction();

			expect(mockCreatePortalSession).toHaveBeenCalledWith(
				'tenant-1',
				expect.stringContaining('/admin/subscription'),
				{ kind: 'subscription_cancel' },
			);
		});

		it('portal の URL へ 303 する（自アプリのプラン画面へ戻して終わりにしない）', async () => {
			mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session_1' });

			const thrown = await runPaidGraduationAction();

			expect(thrown.status).toBe(303);
			expect(thrown.location).toBe('https://billing.stripe.com/session_1');
		});

		it('flow 拒否時は解約を続ける場所を示せる自画面へ戻す (#4270 と同型)', async () => {
			mockCreatePortalSession.mockResolvedValue({
				url: 'https://billing.stripe.com/home_1',
				flowFallback: true,
			});

			const thrown = await runPaidGraduationAction();

			expect(thrown.location).toBe(
				`/admin/subscription?${PORTAL_FALLBACK_PARAM}=${PORTAL_FALLBACK_CONTEXT.CANCEL}`,
			);
		});

		it('portal を作れなければ「解約はまだ完了していません」を出す thanks へ送る (#4329 と同型)', async () => {
			mockCreatePortalSession.mockResolvedValue({ error: 'PORTAL_CREATE_FAILED' });

			const thrown = await runPaidGraduationAction();

			expect(thrown.status).toBe(303);
			expect(thrown.location).toBe(
				`/admin/subscription/cancel/thanks?${PORTAL_UNAVAILABLE_PARAM}=1`,
			);
			// 素の thanks (成功として見える画面) へ無言で落とさない
			expect(thrown.location).not.toBe('/admin/subscription/cancel/thanks');
		});

		it('portal 作成失敗を運用側が観測できる (logger.error)', async () => {
			mockCreatePortalSession.mockResolvedValue({ error: 'PORTAL_CREATE_FAILED' });

			await runPaidGraduationAction();

			expect(mockLoggerError).toHaveBeenCalledTimes(1);
			expect(String(mockLoggerError.mock.calls.at(0)?.[0])).toContain('tenant-1');
		});

		it('Stripe 無効環境では portal を作らず thanks へ送る（既存挙動）', async () => {
			mockIsStripeEnabled.mockReturnValue(false);

			const thrown = await runPaidGraduationAction();

			expect(mockCreatePortalSession).not.toHaveBeenCalled();
			expect(thrown.location).toBe('/admin/subscription/cancel/thanks');
		});
	});
});

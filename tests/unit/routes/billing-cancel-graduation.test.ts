// tests/unit/routes/billing-cancel-graduation.test.ts
// 卒業フロー専用ページ load + form action テスト (#1603 / ADR-0023 §3.8 / §5 I10)
//
// テスト観点:
// - load: 残ポイント合計 + 利用日数 + plan 情報を返す
// - load: child が居ない / point 取得失敗時も totalPoints=0 で表示できる
// - action: nickname 必須 (consented=true 時)
// - action: nickname 30 文字超でエラー
// - action: 課金プラン → /admin/billing にリダイレクト
// - action: 無料プラン → /admin/billing/cancel/thanks にリダイレクト

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 load/action の型を最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindAllChildren = vi.fn();
const mockGetBalance = vi.fn();
const mockGetLicenseInfo = vi.fn();
const mockRecordGraduationConsent = vi.fn();

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
} from '../../../src/routes/(parent)/admin/billing/cancel/graduation/+page.server';

const load = loadRaw as unknown as AnyLoad;
const actions = actionsRaw as unknown as { default: AnyAction };

beforeEach(() => {
	vi.clearAllMocks();
});

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
	return new Request('http://localhost/admin/billing/cancel/graduation', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});
}

describe('billing-cancel-graduation +page.server.ts', () => {
	describe('load', () => {
		it('全子供のポイント合計を計算して返す', async () => {
			mockFindAllChildren.mockResolvedValue([
				{ id: 1, nickname: 'a' },
				{ id: 2, nickname: 'b' },
			]);
			mockGetBalance.mockImplementation(async (childId: number) => {
				if (childId === 1) return 500;
				if (childId === 2) return 800;
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
			mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'a' }]);
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
			});

			expect(result).toMatchObject({
				status: 400,
				data: { errorKey: 'errorNicknameTooLong' },
			});
		});

		it('課金プラン (stripeCustomerId あり) は /admin/billing に redirect', async () => {
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: 'sub_123',
				stripeCustomerId: 'cus_123',
			});
			mockRecordGraduationConsent.mockResolvedValue({
				ok: true,
				record: {
					id: 1,
					tenantId: 'tenant-1',
					nickname: 'たろう家',
					consented: true,
					userPoints: 100,
					usagePeriodDays: 30,
					message: null,
					consentedAt: new Date().toISOString(),
				},
			});

			const request = buildActionRequest({
				consented: 'on',
				nickname: 'たろう家',
				message: '',
				totalPoints: '100',
				usagePeriodDays: '30',
			});

			await expect(
				actions.default({
					request,
					locals: buildLocals(),
				}),
			).rejects.toMatchObject({
				status: 303,
				location: '/admin/billing',
			});
		});

		it('無料プランは /admin/billing/cancel/thanks に redirect', async () => {
			mockGetLicenseInfo.mockResolvedValue({
				createdAt: new Date().toISOString(),
				stripeSubscriptionId: null,
				stripeCustomerId: null,
			});
			mockRecordGraduationConsent.mockResolvedValue({
				ok: true,
				record: {
					id: 1,
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
				}),
			).rejects.toMatchObject({
				status: 303,
				location: '/admin/billing/cancel/thanks',
			});
		});
	});
});

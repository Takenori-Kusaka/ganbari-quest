// cspell:ignore desync — Stripe と DB の状態不一致を指す語 (Issue #4525 本文の用語)
// tests/unit/routes/subscription-cancel-notice-consistency.test.ts
// #4525 — 解約確認画面で **badge と notice が同じ事実を述べる**。
//
// ## 何が壊れていたか
//
// `load` が同一の license オブジェクトから互いに独立な 2 つの値を返していた:
//
//   const plan = license?.plan ?? 'free';                 // → badge (「スタンダードプラン」)
//   const isPaidPlan = !!license?.stripeSubscriptionId;   // → notice の出し分け (false)
//
// `isPaidPlan` は「Stripe subscription を持つか」であって「課金対象の有料プランか」ではない。
// plan が有料でも stripeSubscriptionId が無い tenant (運営付与 / Stripe と DB の desync /
// 解約処理で subscription id がクリアされた後) では、badge が有料プラン名を出す隣で notice が
// 「お支払いは発生しておらず解約のお手続きは必要ありません」と述べる。
//
// ## 実害
//
// **実際には課金が続いているのに解約操作をしない**。#4496 が LP / 特商法から一掃した
// 「事実と異なる案内」と同一クラスで、こちらは金銭が絡む分だけ重い。
//
// ## この test が固定すること
//
// load の戻り値が自己矛盾しないこと (plan が有料なら isPaidPlan も true)。
// 「plan は SSOT、notice は Stripe 由来」という 2 系統を復活させたら落ちる。

// biome-ignore-all lint/suspicious/noExplicitAny: テスト用 load の型を最小化

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLicenseInfo = vi.fn();
const mockGetTrialStatus = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));
vi.mock('$lib/server/services/cancellation-service', () => ({
	submitCancellationReason: vi.fn(),
}));
vi.mock('$lib/server/services/stripe-service', () => ({ createPortalSession: vi.fn() }));
vi.mock('$lib/server/stripe/client', () => ({ isStripeEnabled: () => true }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: (...a: unknown[]) => mockLoggerWarn(...a), error: vi.fn() },
}));
// trial は本 test の主題ではないので「trial 中でない」に固定する
// (resolveFullPlanTier は実物を通す — plan → tier の解決そのものが検証対象のため)。
vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: (...args: unknown[]) => mockGetTrialStatus(...args),
}));
vi.mock('$lib/server/auth/factory', async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	// cloud (cognito) を前提にする。local / anonymous mode の resolvePlanTier は
	// 全機能解放のため常に family を返し、プラン差そのものが消えてしまう。
	getAuthMode: () => 'cognito',
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { CANCELLATION_LABELS } from '$lib/domain/labels';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { load as loadRaw } from '../../../src/routes/(parent)/admin/subscription/cancel/+page.server';

const load = loadRaw as unknown as (ev: any) => Promise<any>;
/**
 * badge (admin/+layout.server.ts) は locals.context の licenseStatus / plan を
 * resolveFullPlanTier に渡す。notice も**同じ入力**で解決するので、test も同じ形で与える。
 */
function locals(licenseStatus: string, plan?: string) {
	return { context: { tenantId: 'tenant-1', licenseStatus, plan } };
}
const LOCALS_FREE = locals(AUTH_LICENSE_STATUS.NONE, undefined);

/**
 * @param plan   tenant.plan (badge の由来)
 * @param subId  tenant.stripeSubscriptionId (旧実装が notice の由来にしていた値)
 */
function license(plan: string, subId: string | null) {
	return {
		plan,
		status: plan === 'free' ? AUTH_LICENSE_STATUS.NONE : AUTH_LICENSE_STATUS.ACTIVE,
		tenantName: 't',
		stripeCustomerId: subId ? 'cus_1' : null,
		stripeSubscriptionId: subId,
		planExpiresAt: null,
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetTrialStatus.mockResolvedValue({
		isTrialActive: false,
		trialEndDate: null,
		trialTier: null,
	});
});

describe('#4525 解約確認画面の badge と notice の整合', () => {
	it('有料プランで Stripe subscription が無くても有料として扱う (旧実装の矛盾)', async () => {
		mockGetLicenseInfo.mockResolvedValue(license('standard', null));

		const data = await load({
			locals: locals(AUTH_LICENSE_STATUS.ACTIVE, 'standard_monthly'),
		} as any);

		// 旧実装はここが false になり、badge「スタンダードプラン」の隣で
		// 「お支払いは発生しておらず解約のお手続きは必要ありません」を出していた。
		expect(data.isPaidPlan).toBe(true);
		expect(data.plan).toBe('standard');
	});

	it('plan が有料なら isPaidPlan も必ず true (badge と notice が食い違わない)', async () => {
		for (const plan of ['standard', 'family']) {
			for (const subId of ['sub_1', null]) {
				mockGetLicenseInfo.mockResolvedValue(license(plan, subId));
				const data = await load({
					locals: locals(AUTH_LICENSE_STATUS.ACTIVE, `${plan}_monthly`),
				} as any);
				expect(
					data.isPaidPlan,
					`plan=${plan} subscription=${subId} で badge と notice が食い違う`,
				).toBe(true);
			}
		}
	});

	it('badge (AdminLayout) と同じ式で導出される', async () => {
		// admin/+layout.server.ts は `isPaidTier(await resolveFullPlanTier(...))` で
		// planTier badge を出す。notice がそれと違う式で出ていたのが #4525 の原因なので、
		// **同じ式の結果と一致すること**を固定する (2 系統に戻したら落ちる)。
		for (const plan of ['free', 'standard', 'family']) {
			const status = plan === 'free' ? AUTH_LICENSE_STATUS.NONE : AUTH_LICENSE_STATUS.ACTIVE;
			const planId = plan === 'free' ? undefined : `${plan}_monthly`;
			mockGetLicenseInfo.mockResolvedValue(license(plan, null));
			const data = await load({ locals: locals(status, planId) } as any);
			const badgeIsPaid = isPaidTier(await resolveFullPlanTier('tenant-1', status, planId));
			expect(data.isPaidPlan, `plan=${plan} で badge と notice の導出が食い違う`).toBe(badgeIsPaid);
		}
	});

	it('無料プランは有料扱いしない (警告を強めすぎない)', async () => {
		mockGetLicenseInfo.mockResolvedValue(license('free', null));
		const data = await load({ locals: LOCALS_FREE } as any);
		expect(data.isPaidPlan).toBe(false);
		expect(data.paidWithoutStripe).toBe(false);
	});

	it('license が取れないときは無料として扱う', async () => {
		mockGetLicenseInfo.mockResolvedValue(null);
		const data = await load({ locals: LOCALS_FREE } as any);
		expect(data.plan).toBe('free');
		expect(data.isPaidPlan).toBe(false);
	});

	describe('有料だが Stripe 契約が無い異常状態', () => {
		it('paidWithoutStripe で識別できる (portal を開けない = 送信しても解約は完了しない)', async () => {
			mockGetLicenseInfo.mockResolvedValue(license('standard', null));
			const data = await load({
				locals: locals(AUTH_LICENSE_STATUS.ACTIVE, 'standard_monthly'),
			} as any);
			expect(data.paidWithoutStripe).toBe(true);
		});

		it('正常な有料プラン (subscription あり) では立たない', async () => {
			mockGetLicenseInfo.mockResolvedValue(license('standard', 'sub_1'));
			const data = await load({
				locals: locals(AUTH_LICENSE_STATUS.ACTIVE, 'standard_monthly'),
			} as any);
			expect(data.paidWithoutStripe).toBe(false);
		});

		it('観測に残す (異常状態を silent に通さない)', async () => {
			mockGetLicenseInfo.mockResolvedValue(license('family', null));
			await load({ locals: locals(AUTH_LICENSE_STATUS.ACTIVE, 'family_monthly') } as any);
			expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
			expect(String(mockLoggerWarn.mock.calls[0]?.[0])).toContain('tenant-1');
		});

		// #4585-1 との合流 (rebase): resolveFullPlanTier は **実効プラン** を返すため、
		// 体験中も standard / family tier になる。isPaidTier をそのまま isPaidPlan にすると
		// 「請求が 1 円も発生していない顧客」が有料契約扱いになり、
		//   - 「次回以降の請求は発生しません」(paidPlanNotice) という無い請求の話をする
		//   - Stripe subscription が無い = 正常なのに paidWithoutStripe が立ち、
		//     サポート窓口へ誘導する異常系の案内を出す
		// という二重の誤案内になる。体験中は課金対象ではないので除外する。
		it('体験中は有料契約扱いにしない (請求が無いのにサポート誘導を出さない)', async () => {
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				// 固定日を書くと将来 test が勝手に壊れる。実行時点から先の日付を作る
				trialEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
				trialTier: 'family',
			});
			mockGetLicenseInfo.mockResolvedValue(license('free', null));

			const data = await load({ locals: LOCALS_FREE } as any);

			// 実効プランは有料相当 (上限超過分の扱いを出すため planTier は保つ)
			expect(data.planTier).toBe('family');
			// が、課金対象ではない
			expect(data.isPaidPlan).toBe(false);
			expect(data.paidWithoutStripe).toBe(false);
			expect(mockLoggerWarn).not.toHaveBeenCalled();
		});

		it('案内はサポート窓口へ誘導する (再試行を促さない)', () => {
			// 再試行しても直らない状態なので「もう一度」は出口にならない (#4548 と同じ判断)
			const notice = CANCELLATION_LABELS.paidWithoutStripeNotice;
			expect(notice).toContain('サポート窓口');
			expect(notice).not.toContain('必要ありません');
			expect(notice).not.toContain('もう一度');
		});
	});
});

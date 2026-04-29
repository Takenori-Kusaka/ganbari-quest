// /admin/billing/cancel — 解約フロー (理由ヒアリング必須) (#1596 / ADR-0023 §3.8 / I3)
//
// 全プラン (free / standard / family / lifetime) で解約理由を必須収集する。
// Stripe の Customer Portal にリダイレクトする前段で「卒業 / 離反 / 中断」3 分類 +
// 自由記述を保存し、PO の解約原因可視化と検証に供する。

import { fail, redirect } from '@sveltejs/kit';
import {
	CANCELLATION_CATEGORIES,
	CANCELLATION_CATEGORY,
	CANCELLATION_LABELS,
} from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { submitCancellationReason } from '$lib/server/services/cancellation-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);

	const plan = license?.plan ?? 'free';
	const isPaidPlan = !!license?.stripeSubscriptionId;
	const hasStripeCustomer = !!license?.stripeCustomerId;

	return {
		plan,
		isPaidPlan,
		hasStripeCustomer,
		stripeEnabled: isStripeEnabled(),
		categories: CANCELLATION_CATEGORIES,
		freeTextMaxLength: CANCELLATION_LABELS.freeTextMaxLength,
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const tenantId = requireTenantId(locals);
		const license = await getLicenseInfo(tenantId);

		const formData = await request.formData();
		const category = String(formData.get('category') ?? '').trim();
		const freeTextRaw = String(formData.get('freeText') ?? '').trim();

		if (!category) {
			return fail(400, {
				error: CANCELLATION_LABELS.errorCategoryRequired,
				category: '',
				freeText: freeTextRaw,
			});
		}

		const result = await submitCancellationReason({
			tenantId,
			category,
			freeText: freeTextRaw.length > 0 ? freeTextRaw : null,
			planAtCancellation: license?.plan ?? 'free',
			stripeSubscriptionId: license?.stripeSubscriptionId ?? null,
		});

		if (!result.ok) {
			const errorMessage =
				result.error === 'INVALID_CATEGORY'
					? CANCELLATION_LABELS.errorCategoryRequired
					: CANCELLATION_LABELS.errorFreeTextTooLong;
			return fail(400, {
				error: errorMessage,
				category,
				freeText: freeTextRaw,
			});
		}

		// #1603 ADR-0023 §5 I10: 「卒業」選択時は専用ページへ
		// ポイント還元提案 + 祝福演出 + 事例公開承諾を表示してから解約完了へ進む。
		if (category === CANCELLATION_CATEGORY.GRADUATION) {
			throw redirect(303, '/admin/billing/cancel/graduation');
		}

		// 課金プランかつ Stripe Customer がある場合 → Customer Portal にリダイレクト
		if (license?.stripeCustomerId && isStripeEnabled()) {
			const returnUrl = new URL('/admin/billing', url).toString();
			const portalResult = await createPortalSession(tenantId, returnUrl);
			if ('url' in portalResult) {
				throw redirect(303, portalResult.url);
			}
			// Portal 作成失敗時は success ページに留めて手動完了を促す
		}

		// 無料プラン or Portal 未利用時は thanks ページに遷移
		throw redirect(303, '/admin/billing/cancel/thanks');
	},
};

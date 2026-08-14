// /admin/subscription/cancel — 解約フロー (理由ヒアリング必須) (#1596 / ADR-0023 §3.8 / I3)
//
// 全プラン (free / standard / family / lifetime) で解約理由を必須収集する。
// Stripe の Customer Portal にリダイレクトする前段で「卒業 / 離反 / 中断」3 分類 +
// 自由記述を保存し、PO の解約原因可視化と検証に供する。

import { fail, redirect } from '@sveltejs/kit';
import {
	buildPortalFallbackLocation,
	PORTAL_FALLBACK_CONTEXT,
	PORTAL_UNAVAILABLE_PARAM,
} from '$lib/domain/constants/stripe-portal';
import {
	CANCELLATION_CATEGORIES,
	CANCELLATION_CATEGORY,
	CANCELLATION_LABELS,
} from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { submitCancellationReason } from '$lib/server/services/cancellation-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);

	const plan = license?.plan ?? 'free';
	const isPaidPlan = !!license?.stripeSubscriptionId;
	const hasStripeCustomer = !!license?.stripeCustomerId;

	// #4585-1: 解約すると無料プランに戻る顧客には、上限超過分の扱いを解約前に決めさせる。
	// 判定軸は license.plan ではなく**実効プラン** (トライアル中も上限は有料相当) にする。
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? 'none',
		locals.context?.plan,
	);
	// fallback (選ばずに手続きが完了した場合) で何が残るかを画面で述べるための上限値。
	// 数値の SSOT は plan-limit-service。画面側で書き写さない。
	const freeLimits = getPlanLimits('free');

	return {
		plan,
		planTier,
		isPaidPlan,
		hasStripeCustomer,
		stripeEnabled: isStripeEnabled(),
		categories: CANCELLATION_CATEGORIES,
		freeTextMaxLength: CANCELLATION_LABELS.freeTextMaxLength,
		freeLimits: {
			maxChildren: freeLimits.maxChildren,
			maxActivities: freeLimits.maxActivities,
			maxChecklistTemplates: freeLimits.maxChecklistTemplates,
		},
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
			throw redirect(303, '/admin/subscription/cancel/graduation');
		}

		// 課金プランかつ Stripe Customer がある場合 → Customer Portal にリダイレクト
		if (license?.stripeCustomerId && isStripeEnabled()) {
			const returnUrl = new URL('/admin/subscription', url).toString();
			// #4166 AC4: 解約理由フォームを埋めきった顧客を portal ホームに放り出さない。
			// ホームからは自分で「サブスクリプションをキャンセル」を探すことになり、
			// 特商法の解約導線の実効性に接続する。解約フローへ直行させる。
			const portalResult = await createPortalSession(tenantId, returnUrl, {
				kind: 'subscription_cancel',
			});
			if ('url' in portalResult) {
				// #4270: 解約フローが Stripe に拒否されて portal ホームに倒れた場合、そのまま
				// 飛ばすと「解約理由を書き終えた直後に予期しない画面へ落ちる」体験になる
				// (直行を期待させた分だけ落差が大きい)。原因は顧客に説明せず (ADR-0062)、
				// 解約手続きを続ける場所を示せる自画面へ戻す。
				if (portalResult.flowFallback) {
					// #4548: **理由も渡す**。ご契約情報が確認できない状態は再試行しても直らないため、
					// 戻り先は「もう一度」ではなくサポート窓口を出す必要がある。
					throw redirect(
						303,
						buildPortalFallbackLocation(PORTAL_FALLBACK_CONTEXT.CANCEL, portalResult.flowFallback),
					);
				}
				throw redirect(303, portalResult.url);
			}
			// #4329: ここは portal を **1 度も開けていない**経路。旧実装は無言で thanks へ落とし、
			// 顧客は「ありがとうございました」だけを見て解約できたと思い込んだまま課金が続いた
			// (特商法の解約導線の実効性)。失敗した事実を thanks ページへ伝え、代替導線を出させる。
			// 原因の内部詳細は顧客に出さない (ADR-0062) — 観測は logger + alert 側で持つ。
			logger.error(
				`[STRIPE] 解約フローで portal を作成できませんでした: tenant=${tenantId} reason=${portalResult.error}`,
			);
			throw redirect(303, `/admin/subscription/cancel/thanks?${PORTAL_UNAVAILABLE_PARAM}=1`);
		}

		// 無料プラン or Portal 未利用時は thanks ページに遷移
		throw redirect(303, '/admin/subscription/cancel/thanks');
	},
};

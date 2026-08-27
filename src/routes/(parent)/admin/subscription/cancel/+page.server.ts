// cspell:ignore desync — Stripe と DB の状態不一致を指す語 (Issue #4525 本文の用語)
// /admin/subscription/cancel — 解約フロー (理由ヒアリング必須) (#1596 / ADR-0023 §3.8 / I3)
//
// 全プラン (free / standard / family / lifetime) で解約理由を必須収集する。
// Stripe の Customer Portal にリダイレクトする前段で「卒業 / 離反 / 中断」3 分類 +
// 自由記述を保存し、PO の解約原因可視化と検証に供する。

import { fail, redirect } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
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
import {
	getPlanLimits,
	isPaidTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { getTrialStatus } from '$lib/server/services/trial-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);

	const plan = license?.plan ?? 'free';

	// #4525: notice の出し分けを **badge と同じ SSOT** から導出する。
	//
	//   旧: isPaidPlan = !!license?.stripeSubscriptionId
	//
	// これは「Stripe subscription を持つか」であって「顧客が課金対象の有料プランか」ではない。
	// plan が有料でも stripeSubscriptionId が無い tenant (運営付与 / Stripe と DB の desync /
	// 解約処理で subscription id がクリアされた後) では、badge が「スタンダードプラン」を出す
	// 隣で notice が「お支払いは発生しておらず解約のお手続きは必要ありません」と述べていた。
	// **実際には課金が続いているのに解約操作をしない**という最悪の誤誘導になる。
	// 退会画面の猶予判定と同じく resolveFullPlanTier を使う。
	// **badge と完全に同じ入力**で解決する。admin/+layout.server.ts は locals.context の
	// licenseStatus / plan を渡しており、tenant 行 (getLicenseInfo) とは別系統。
	// tenant 行を渡すと dev / 本番で badge と食い違いうるため、入力ごと揃える。
	//
	// #4585-1 との合流 (#4525): planTier は**実効プラン**なので体験中も有料 tier を返す。
	// そのまま isPaidPlan にすると、請求が 1 円も発生していない体験中の顧客に
	// 「現在の請求期間の終了日まで…次回以降の請求は発生しません」と述べてしまう。
	// isPaidPlan は「課金対象の有料契約か」を意味づけとして持たせ、体験中は除外する
	// (体験中の案内は trialPlanNotice、上限超過分の扱いは planTier 側で引き続き提示する)。
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	// getTrialStatus はリクエストスコープでキャッシュされ、resolveFullPlanTier が
	// 既に同一 tenant で呼んでいるため追加の DB アクセスは発生しない (#788)。
	const { isTrialActive } = await getTrialStatus(tenantId);
	const isPaidPlan = isPaidTier(planTier) && !isTrialActive;
	const hasStripeCustomer = !!license?.stripeCustomerId;

	// #4585-1: 解約すると無料プランに戻る顧客には、上限超過分の扱いを解約前に決めさせる。
	// fallback (選ばずに手続きが完了した場合) で何が残るかを画面で述べるための上限値。
	// 数値の SSOT は plan-limit-service。画面側で書き写さない。
	const freeLimits = getPlanLimits('free');

	// #4525: 「有料プランなのに Stripe 契約が無い」= 本来ありえない状態。この画面から
	// portal を開けないため、顧客には再試行ではなくサポート窓口を案内する必要がある
	// (submit しても thanks に落ちるだけで解約は完了しない)。状態自体が異常なので観測に残す。
	// 体験中は isPaidPlan=false のため、ここには入らない (体験に Stripe 契約は無いのが正常)。
	const paidWithoutStripe = isPaidPlan && !license?.stripeSubscriptionId;
	if (paidWithoutStripe) {
		logger.warn(
			`[BILLING] 有料プランだが Stripe subscription がありません (解約導線を portal に繋げられません): tenant=${tenantId} plan=${plan} tier=${planTier} hasCustomer=${hasStripeCustomer}`,
		);
	}

	return {
		plan,
		planTier,
		isPaidPlan,
		paidWithoutStripe,
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

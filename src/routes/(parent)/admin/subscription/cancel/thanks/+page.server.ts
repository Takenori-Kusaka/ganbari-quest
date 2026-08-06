// /admin/subscription/cancel/thanks — 解約理由送信完了後の thanks ページ (#1596)
//
// #4329: 「ありがとうございました」だけを見せて終わる画面ではない。**解約手続きが
// 残っている場合がある**ため、残っていることと、その場で続ける手段を出す責務を持つ。

import { fail, redirect } from '@sveltejs/kit';
import {
	PORTAL_FALLBACK_CONTEXT,
	PORTAL_FALLBACK_PARAM,
	PORTAL_UNAVAILABLE_PARAM,
} from '$lib/domain/constants/stripe-portal';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);

	const isPaidPlan = !!license?.stripeSubscriptionId;
	const hasStripeCustomer = !!license?.stripeCustomerId;
	const stripeEnabled = isStripeEnabled();

	return {
		isPaidPlan,
		hasStripeCustomer,
		stripeEnabled,
		// #4329: 解約 action が portal を作れなかったときだけ立つ。**契約が生きているのに
		// この画面に来た**時点で手続きは残っているため、param が無くても同じ扱いにする
		// (直リンク / 再読み込みで param が落ちても「解約できたつもり」を作らない)。
		portalUnavailable:
			url.searchParams.get(PORTAL_UNAVAILABLE_PARAM) === '1' ||
			(isPaidPlan && hasStripeCustomer && stripeEnabled),
		// #4329: `labels: CANCELLATION_LABELS` を返していたが、この定数は関数 (`freeTextHint`) を
		// 含むため **load の戻り値がシリアライズできず、この画面は常に 500 になっていた**
		// (解約導線の最後で顧客がエラーページに落ちる)。画面側は labels を直接 import しており
		// この受け渡しは元々使われていない。
	};
};

export const actions: Actions = {
	// #4329: 「Stripe へ行く」と名乗る CTA が実際に Stripe へ行く唯一の手段。
	// 旧実装のボタンは自アプリのプラン画面へ戻すだけで、顧客は解約できたと誤解していた。
	openPortal: async ({ locals, url }) => {
		const tenantId = requireTenantId(locals);
		const returnUrl = new URL('/admin/subscription', url).toString();

		const portalResult = await createPortalSession(tenantId, returnUrl, {
			kind: 'subscription_cancel',
		});

		if ('url' in portalResult) {
			// flow が拒否された場合は portal ホームに着く。#4270 と同じく、どこで手続きを
			// 続けるかを示せる自画面へ戻す (顧客に原因は説明しない、ADR-0062)。
			if (portalResult.flowFallback) {
				throw redirect(
					303,
					`/admin/subscription?${PORTAL_FALLBACK_PARAM}=${PORTAL_FALLBACK_CONTEXT.CANCEL}`,
				);
			}
			throw redirect(303, portalResult.url);
		}

		logger.error(
			`[STRIPE] 解約 thanks からの portal 再試行に失敗しました: tenant=${tenantId} reason=${portalResult.error}`,
		);
		// 内部の失敗コードは載せない。顧客には「次に取れる手」だけを返す (ADR-0062)。
		return fail(503, { portalRetryFailed: true });
	},
};

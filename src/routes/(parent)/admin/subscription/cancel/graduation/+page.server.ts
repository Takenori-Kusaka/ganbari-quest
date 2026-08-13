// /admin/subscription/cancel/graduation — 卒業フロー専用ページ (#1603 / ADR-0023 §3.8 / §5 I10)
//
// 解約フロー (#1596) で「卒業」を選んだ親向けの専用ページ。
// - 残ポイント表示 + 還元提案 (現金換算 / 物品 / 体験)
// - 祝福ビジュアル (既存 hero-default.png キャラ)
// - 任意の事例公開承諾チェックボックス + ニックネーム + メッセージ
//
// Anti-engagement (ADR-0012): 引き止め CTA 出さない。煽らない。「もう一度」は出さない。

import { fail, redirect } from '@sveltejs/kit';
import {
	buildPortalFallbackLocation,
	PORTAL_FALLBACK_CONTEXT,
	PORTAL_UNAVAILABLE_PARAM,
} from '$lib/domain/constants/stripe-portal';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { getBalance } from '$lib/server/db/point-repo';
import { logger } from '$lib/server/logger';
import {
	calculateUsagePeriodDays,
	GRADUATION_MESSAGE_MAX_LENGTH,
	GRADUATION_NICKNAME_MAX_LENGTH,
	recordGraduationConsent,
} from '$lib/server/services/graduation-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
import { createPortalSession } from '$lib/server/services/stripe-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

const POINTS_TO_YEN_RATE = 1; // 100 pt = 100 円換算 (1 pt = 1 円)

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const license = await getLicenseInfo(tenantId);
	const repos = getRepos();

	// 全子供のポイント残高合計を集計
	const children = await repos.child.findAllChildren(tenantId);
	let totalPoints = 0;
	for (const child of children) {
		try {
			const balance = await getBalance(child.id, tenantId);
			totalPoints += balance;
		} catch {
			// 個別 child のポイント取得失敗は無視（合計を 0 にしない）
		}
	}

	const usagePeriodDays = license?.createdAt ? calculateUsagePeriodDays(license.createdAt) : 0;
	const yenAmount = totalPoints * POINTS_TO_YEN_RATE;

	const isPaidPlan = !!license?.stripeSubscriptionId;
	const hasStripeCustomer = !!license?.stripeCustomerId;

	return {
		totalPoints,
		yenAmount,
		usagePeriodDays,
		isPaidPlan,
		hasStripeCustomer,
		// #4498: 送信ボタンの名乗りを実際の遷移先に合わせるために画面へ渡す。
		// action の分岐条件 (`stripeCustomerId && isStripeEnabled()`) と同じ材料で判定する。
		stripeEnabled: isStripeEnabled(),
		nicknameMaxLength: GRADUATION_NICKNAME_MAX_LENGTH,
		messageMaxLength: GRADUATION_MESSAGE_MAX_LENGTH,
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const tenantId = requireTenantId(locals);
		const license = await getLicenseInfo(tenantId);

		const formData = await request.formData();
		const consented = formData.get('consented') === 'on';
		const nicknameRaw = String(formData.get('nickname') ?? '').trim();
		const messageRaw = String(formData.get('message') ?? '').trim();
		const totalPoints = Number(formData.get('totalPoints') ?? 0);
		const usagePeriodDays = Number(formData.get('usagePeriodDays') ?? 0);

		// 公開承諾するなら nickname 必須。承諾しない場合はデフォルトで「匿名の卒業生」
		const nickname = nicknameRaw.length > 0 ? nicknameRaw : '匿名の卒業生';

		const result = await recordGraduationConsent({
			tenantId,
			nickname,
			consented,
			userPoints: Number.isFinite(totalPoints) ? totalPoints : 0,
			usagePeriodDays: Number.isFinite(usagePeriodDays) ? usagePeriodDays : 0,
			message: messageRaw.length > 0 ? messageRaw : null,
		});

		if (!result.ok) {
			let errorKey: 'errorNicknameRequired' | 'errorNicknameTooLong' | 'errorMessageTooLong' =
				'errorNicknameRequired';
			if (result.error === 'NICKNAME_TOO_LONG') errorKey = 'errorNicknameTooLong';
			else if (result.error === 'MESSAGE_TOO_LONG') errorKey = 'errorMessageTooLong';
			return fail(400, {
				errorKey,
				consented,
				nickname: nicknameRaw,
				message: messageRaw,
			});
		}

		// 卒業セッション記録完了 → 解約完了処理
		// #4498: 課金プランかつ Stripe Customer がある場合は Customer Portal の**解約フロー**へ直行する。
		// 旧実装はここで `/admin/subscription` へ戻すだけで `createPortalSession` を呼んでおらず、
		// 「卒業を完了する」を押した顧客は手続き完了と誤認したまま**課金が継続していた**
		// (遷移先は通常の有効プラン表示で、解約予定バナーも出ない)。
		// 離反/中断経路 (`cancel/+page.server.ts`、#4166 / #4270 / #4329) と同型に揃える。
		if (license?.stripeCustomerId && isStripeEnabled()) {
			const returnUrl = new URL('/admin/subscription', url).toString();
			const portalResult = await createPortalSession(tenantId, returnUrl, {
				kind: 'subscription_cancel',
			});
			if ('url' in portalResult) {
				// #4270: 解約フローが Stripe に拒否されて portal ホームに倒れた場合、そのまま飛ばすと
				// 卒業を見届けた直後に予期しない画面へ落ちる。原因は顧客に説明せず (ADR-0062)、
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
			// #4329 と同型: portal を **1 度も開けていない**経路。無言で thanks へ落とすと顧客は
			// 解約できたと思い込んだまま課金が続く。失敗した事実を thanks ページへ伝え、
			// 「解約はまだ完了していません」+ 代替導線を出させる (内部詳細は出さない、ADR-0062)。
			logger.error(
				`[STRIPE] 卒業フローで portal を作成できませんでした: tenant=${tenantId} reason=${portalResult.error}`,
			);
			throw redirect(303, `/admin/subscription/cancel/thanks?${PORTAL_UNAVAILABLE_PARAM}=1`);
		}

		// 無料プラン or Stripe 未有効時は thanks ページへ
		throw redirect(303, '/admin/subscription/cancel/thanks');
	},
};

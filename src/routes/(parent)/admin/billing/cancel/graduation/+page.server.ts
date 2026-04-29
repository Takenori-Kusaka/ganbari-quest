// /admin/billing/cancel/graduation — 卒業フロー専用ページ (#1603 / ADR-0023 §3.8 / §5 I10)
//
// 解約フロー (#1596) で「卒業」を選んだ親向けの専用ページ。
// - 残ポイント表示 + 還元提案 (現金換算 / 物品 / 体験)
// - 祝福ビジュアル (既存 hero-default.png キャラ)
// - 任意の事例公開承諾チェックボックス + ニックネーム + メッセージ
//
// Anti-engagement (ADR-0012): 引き止め CTA 出さない。煽らない。「もう一度」は出さない。

import { fail, redirect } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { getBalance } from '$lib/server/db/point-repo';
import {
	calculateUsagePeriodDays,
	GRADUATION_MESSAGE_MAX_LENGTH,
	GRADUATION_NICKNAME_MAX_LENGTH,
	recordGraduationConsent,
} from '$lib/server/services/graduation-service';
import { getLicenseInfo } from '$lib/server/services/license-service';
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
		nicknameMaxLength: GRADUATION_NICKNAME_MAX_LENGTH,
		messageMaxLength: GRADUATION_MESSAGE_MAX_LENGTH,
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
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
		// 課金プランかつ Stripe Customer がある場合 → Customer Portal にリダイレクト
		if (license?.stripeCustomerId) {
			throw redirect(303, '/admin/billing');
		}

		// 無料プランは thanks ページへ
		throw redirect(303, '/admin/billing/cancel/thanks');
	},
};

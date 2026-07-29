// src/routes/api/v1/admin/tenant/reactivate/+server.ts
// 解約の取り消し（期末解約の予約を解除）— owner 限定
//
// #3991: 「解約申請中か」の判定を **Stripe の `cancel_at_period_end`** に一本化した (NFR-2)。
//
// 旧実装は DB の `status === grace_period` を「解約申請中」と読んでいたが、この値は
// **支払い失敗の dunning 猶予** (`handlePaymentFailed`) でも書かれる同じ値だった (#3986)。
// そのため (a) 支払いが未了のテナントが本 API を通過して ACTIVE に戻り課金なしで有料機能が復活する、
// (b) 本来の解約申請者は即時キャンセル直後の `customer.subscription.deleted` で `suspended` に
// 上書きされてこの 409 に必ず弾かれる、という二重の誤りが同時に起きていた。
//
// 期末解約では契約が期末まで生き続けるため、取り消しは `cancel_at_period_end=false` に戻すだけで
// 完了する (Checkout のやり直し不要)。DB の契約状態は解約申請中も `active` のままなので、
// **本エンドポイントは DB を一切書き換えない**。

import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { OWNER_GATE_LABELS } from '$lib/domain/labels';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyCancellationReverted } from '$lib/server/services/discord-notify-service';
import {
	type ResumeSubscriptionResult,
	resumeSubscription,
} from '$lib/server/services/stripe-service';

export const POST: RequestHandler = async ({ locals }) => {
	const context = locals.context;

	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	// #3556: role 判定は requireRole seam (#3528 fitness#3) に統一。
	// #3561: 403 文言は OWNER_GATE_LABELS (SSOT)、401/403 変換は ownerGateResponse に集約。
	const guard = ownerGateResponse(locals, OWNER_GATE_LABELS.tenantReactivate);
	if (guard) {
		return guard;
	}

	const tenantId = context.tenantId;

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) {
		return json({ error: 'テナントが見つかりません' }, { status: 404 });
	}

	let result: ResumeSubscriptionResult;
	try {
		result = await resumeSubscription(tenantId);
	} catch (err) {
		logger.error('[tenant] 解約キャンセル: Stripe 予約解除に失敗', {
			context: { tenantId, error: String(err) },
		});
		throw error(500, '決済サービスとの通信に失敗しました。時間をおいて再度お試しください。');
	}

	// **到達する経路**: 期末が到来して `customer.subscription.deleted` が契約を終端させた後
	// (`stripeSubscriptionId` が NULL 化済) に取り消しを試みたケース。この時点では Stripe 側に
	// 復元できる契約が無いため、Checkout をやり直す必要がある。
	if (result.status === 'not_subscribed') {
		return json(
			{
				error: '再購読が必要です',
				reason: 'subscription_cancelled',
				redirectTo: '/pricing',
			},
			{ status: 409 },
		);
	}

	// #3986: 支払い失敗で dunning 中のテナントはここで止まる (`cancel_at_period_end=false`)。
	// 未払いのまま有料機能を復活させない。
	if (result.status === 'not_scheduled') {
		return json({ error: '解約手続き中ではありません' }, { status: 409 });
	}

	notifyCancellationReverted(tenantId).catch(() => {});

	logger.info('[tenant] 解約キャンセル (期末解約の予約を解除)', {
		context: { tenantId, subscriptionId: result.state.subscriptionId },
	});

	return json({ success: true, cancelAtPeriodEnd: false });
};

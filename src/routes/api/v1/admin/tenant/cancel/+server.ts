// src/routes/api/v1/admin/tenant/cancel/+server.ts
// 解約申請（期末解約の予約）— owner 限定
//
// #3991 (FR-1 / NFR-2、PO 確定 2026-05-27 の未実装分):
// 解約は **期末解約** (`cancel_at_period_end=true`) で予約する。支払済の請求期間が終わるまでは
// 有料機能をそのまま使え、その間はいつでも取り消せる。
//
// 旧実装 (#784) は `stripe.subscriptions.cancel()` の即時キャンセル + DB を
// `status=grace_period` / `planExpiresAt=now+30d` に書き換える形だった。これには 3 つの欠陥があった:
//   1. 即時キャンセルの直後に `customer.subscription.deleted` が届き、書いたばかりの
//      `grace_period` を `suspended` へ上書きするため、**約束した取り消し導線が 1 度も機能しない**
//   2. 特商法表示「解約後は現在の請求期間終了まで引き続きご利用いただけます」と実装が不一致
//   3. `GRACE_PERIOD_DAYS = 30` のプラン非依存固定が、利用規約のプラン別猶予 (standard 7 日) とも不一致
//
// 案 A ではこの 3 つがまとめて消える。**このエンドポイントは DB の契約状態を一切書かない**。
// 「解約申請中か」の SSOT は Stripe の `cancel_at_period_end` であり (NFR-2)、期末到来時に
// Stripe が発火する `customer.subscription.deleted` が終端状態への収束を担う。

import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { OWNER_GATE_LABELS } from '$lib/domain/labels';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendCancellationEmail } from '$lib/server/services/email-service';
import {
	type ScheduleCancellationResult,
	scheduleCancellationAtPeriodEnd,
} from '$lib/server/services/stripe-service';

export const POST: RequestHandler = async ({ locals }) => {
	const context = locals.context;

	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	// #3556: role 判定は requireRole seam (#3528 fitness#3) に統一。
	// #3561: 403 文言は OWNER_GATE_LABELS (SSOT)、401/403 変換は ownerGateResponse に集約。
	const guard = ownerGateResponse(locals, OWNER_GATE_LABELS.tenantCancel);
	if (guard) {
		return guard;
	}

	const tenantId = context.tenantId;

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) {
		return json({ error: 'テナントが見つかりません' }, { status: 404 });
	}

	// #3991: `grace_period` (= 支払い失敗の dunning 猶予) は解約を妨げない。支払いが通らない
	// テナントこそ解約したいのであり、旧実装の `grace_period → 409` は解約軸と dunning 軸の
	// 混同から来ていた。解約済みかどうかの判定は Stripe (`already_scheduled`) に委ねる。
	if (tenant.status === SUBSCRIPTION_STATUS.TERMINATED) {
		return json({ error: 'アカウントは既に削除済みです' }, { status: 409 });
	}

	// Stripe 呼び出しが失敗した場合は 500。DB は元から書かないので整合性の問題は起きない。
	let result: ScheduleCancellationResult;
	try {
		result = await scheduleCancellationAtPeriodEnd(tenantId);
	} catch (err) {
		logger.error('[tenant] 解約申請: Stripe 期末解約の予約に失敗', {
			context: { tenantId, error: String(err) },
		});
		throw error(500, '決済サービスとの通信に失敗しました。時間をおいて再度お試しください。');
	}

	if (result.status === 'not_subscribed') {
		return json({ error: '有料プランを契約していません' }, { status: 409 });
	}
	if (result.status === 'already_scheduled') {
		return json({ error: '既に解約手続き中です' }, { status: 409 });
	}

	const periodEndAt = result.state.currentPeriodEnd;
	// #4015 整合: サーバの TZ に依存させず JST 固定で整形する (メール文面と Discord 通知に載る)。
	const periodEndDate = periodEndAt
		? new Date(periodEndAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
		: '';

	// 通知（非同期、エラーは握りつぶす）
	const ownerEmail = locals.identity?.type === 'cognito' ? locals.identity.email : undefined;
	if (ownerEmail) {
		sendCancellationEmail(ownerEmail, periodEndDate).catch(() => {});
	}
	// #4192: 解約の Discord 通知は**持たないと決めた** (#4174 Q2)。解約理由は cancellation_reasons に
	// 残り、通知で見ても何もできない。事実は下の logger.info (tenantId 付き) が残す。

	logger.info('[tenant] 解約申請 (期末解約を予約)', {
		context: { tenantId, periodEndAt, subscriptionId: result.state.subscriptionId },
	});

	return json({
		success: true,
		cancelAtPeriodEnd: true,
		periodEndAt,
		periodEndDate,
	});
};

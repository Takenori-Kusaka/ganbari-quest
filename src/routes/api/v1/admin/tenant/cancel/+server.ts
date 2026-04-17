// src/routes/api/v1/admin/tenant/cancel/+server.ts
// 解約申請（grace_period 開始）— owner 限定
//
// #784: Stripe Subscription を即時キャンセルしてから grace_period に遷移する。
// 旧実装は DB のテナント状態だけを更新しており、Stripe 側の課金が継続する
// クリティカルバグ（チャージバック・Stripe アカウントリスク）があった。
//
// 設計: 解約時は Stripe を即時キャンセル（cancel_at_period_end=false）し、
// データは 30 日間の grace_period で保持する。これにより：
//   - 課金は即座に停止（本 issue の主目的）
//   - ユーザーは 30 日間のデータ保持期間中に気が変わればアカウント削除を撤回できる
//   - ただし解約キャンセル（reactivate）後の再購読は Stripe Checkout を再度通す
//     必要がある。reactivate 側でガードを設けている。
//
// 因果順序: Stripe cancel → DB 更新。Stripe 呼び出しが失敗した場合は例外を投げ、
// DB 更新をスキップさせる（#741 のアカウント削除と同じパターン）。

import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyCancellation } from '$lib/server/services/discord-notify-service';
import { sendCancellationEmail } from '$lib/server/services/email-service';
import { cancelSubscription } from '$lib/server/services/stripe-service';

const GRACE_PERIOD_DAYS = 30;

export const POST: RequestHandler = async ({ locals }) => {
	const context = locals.context;

	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	if (context.role !== 'owner') {
		return json({ error: 'owner のみ解約申請できます' }, { status: 403 });
	}

	const tenantId = context.tenantId;

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) {
		return json({ error: 'テナントが見つかりません' }, { status: 404 });
	}

	if (tenant.status === SUBSCRIPTION_STATUS.GRACE_PERIOD) {
		return json({ error: '既に解約手続き中です' }, { status: 409 });
	}
	if (tenant.status === SUBSCRIPTION_STATUS.TERMINATED) {
		return json({ error: 'アカウントは既に削除済みです' }, { status: 409 });
	}

	// #784: Stripe Subscription を即時キャンセル（DB 更新より前に実行）
	// 失敗した場合は 500 で返し、DB 状態は変更しない（課金継続防止）
	let stripeCancelResult: Awaited<ReturnType<typeof cancelSubscription>>;
	try {
		stripeCancelResult = await cancelSubscription(tenantId);
	} catch (err) {
		logger.error('[tenant] 解約申請: Stripe キャンセル失敗', {
			context: { tenantId, error: String(err) },
		});
		// 50x で返すことで、フロントエンドが「解約申請に失敗しました」を表示し
		// 再試行を促す。DB は未更新なので整合性は保たれる。
		throw error(500, '決済サービスとの通信に失敗しました。時間をおいて再度お試しください。');
	}

	// 猶予期間終了日を計算
	const graceEnd = new Date();
	graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);
	const graceEndAt = graceEnd.toISOString();

	await repos.auth.updateTenantStripe(tenantId, {
		status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
		planExpiresAt: graceEndAt,
	});

	// 通知（非同期、エラーは握りつぶす）
	const graceEndDate = graceEnd.toLocaleDateString('ja-JP');
	const ownerEmail = locals.identity?.type === 'cognito' ? locals.identity.email : undefined;
	if (ownerEmail) {
		sendCancellationEmail(ownerEmail, graceEndDate).catch(() => {});
	}
	notifyCancellation(tenantId, graceEndDate).catch(() => {});

	logger.info('[tenant] 解約申請', {
		context: { tenantId, graceEndAt, stripeResult: stripeCancelResult.status },
	});

	return json({
		success: true,
		graceEndAt,
		graceEndDate,
		stripeCancelStatus: stripeCancelResult.status,
	});
};

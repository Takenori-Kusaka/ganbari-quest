// POST /api/cron/stripe-webhook-delivery-check — Stripe webhook 未達の検知 cron (#3959)
//
// EventBridge (Scheduled Rule) から 1 時間毎に呼び出される。認証は verifyCronAuth 共通ヘルパー。
//
// 検知ロジックと PR #4079 (`stripe-webhook-handler-failed`) との責務分界は
// `src/lib/server/services/stripe-webhook-delivery-monitor.ts` 冒頭が SSOT。

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { checkWebhookDelivery } from '$lib/server/services/stripe-webhook-delivery-monitor';
import { notifyStripeAlertAsync } from '$lib/server/stripe/alert';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	logger.info('[stripe-webhook-delivery-check] endpoint started', {
		service: 'stripe',
	});

	try {
		const result = await checkWebhookDelivery();

		logger.info('[stripe-webhook-delivery-check] endpoint completed', {
			service: 'stripe',
			context: {
				skipped: result.skipped,
				checked: result.checked,
				staleCount: result.staleEvents.length,
				unreflectedCount: result.unreflectedCheckouts.length,
				truncated: result.truncated,
				alerted: result.alerted,
			},
		});

		return json({ ok: true, ...result });
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		const errorName = e instanceof Error ? e.name : 'UnknownError';

		// message 本文に detail を畳む。logger は console に message しか出さないため、
		// 第 2 引数の `error` field だけでは CloudWatch に何も残らない (stack は別途出力される)。
		logger.error(`[stripe-webhook-delivery-check] cron failed: ${detail}`, {
			service: 'stripe',
			error: detail,
			stack: e instanceof Error ? e.stack : undefined,
		});

		// 検知器が死んでいること自体を鳴らす (#4102 M3)。
		// cron dispatcher (infra/lambda/cron-dispatcher/index.ts) は非 2xx を throw せず
		// `{ statusCode: 500 }` を return するため、ここで alert を出さないと Lambda invocation は
		// 成功扱いのまま `cron-dispatcher-errors` alarm も鳴らず、「未達を検知できていない」ことが
		// 誰にも届かない = 本 endpoint が潰そうとしている失敗クラスそのものになる。
		//
		// **alert には例外の生 message を載せない**。DSQL の接続エラー等は接続情報 / token 断片を
		// 含みうるため、外部 (Discord) に出すのは例外クラス名までに留め、詳細は上の CloudWatch log
		// (message + stack) で見る (#4101 の経路を新たに開かないため)。
		// errorSummary は固定文字列 = throttle key が安定し、連続失敗が 1 通にまとまる。
		await notifyStripeAlertAsync({
			kind: 'stripe-webhook-monitor-failed',
			message:
				'Stripe webhook 未達の検知 cron 自体が失敗しました (検知が止まっている間の未達は誰も気づけません)',
			errorSummary: 'stripe-webhook-monitor-failed',
			tags: { errorName },
		});

		return json({ ok: false, error: detail }, { status: 500 });
	}
};

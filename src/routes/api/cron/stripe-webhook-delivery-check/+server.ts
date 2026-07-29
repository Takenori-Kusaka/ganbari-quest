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
		logger.error('[stripe-webhook-delivery-check] cron failed', {
			service: 'stripe',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
	}
};

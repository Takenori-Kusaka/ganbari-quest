import { json } from '@sveltejs/kit';
import { deleteByEndpoint } from '$lib/server/db/push-subscription-repo';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context?.tenantId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await request.json()) as { endpoint: string };

		if (!body.endpoint) {
			return json({ error: 'Missing endpoint' }, { status: 400 });
		}

		await deleteByEndpoint(body.endpoint, context.tenantId);
		return json({ success: true });
	} catch (err) {
		// #3814 (ADR-0062): 内部例外を client へ露出しない。詳細は server log のみに残し、
		// client には汎用 message を返す (info-disclosure 防止)。subscribe route と対称。
		logger.error('[notifications/unsubscribe] unsubscribe 失敗', {
			context: { tenantId: context.tenantId },
			error: err instanceof Error ? err.message : String(err),
		});
		return json({ error: 'Unsubscribe failed' }, { status: 500 });
	}
};

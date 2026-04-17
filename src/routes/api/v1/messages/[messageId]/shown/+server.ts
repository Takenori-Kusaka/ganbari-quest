import { json } from '@sveltejs/kit';
import { notFound } from '$lib/server/errors';
import { markAsShown } from '$lib/server/services/message-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const messageId = Number(params.messageId);
	if (!messageId || Number.isNaN(messageId)) {
		return notFound('メッセージが見つかりません');
	}

	const result = await markAsShown(messageId, tenantId);
	if (!result) {
		return notFound('メッセージが見つかりません');
	}

	return json({ ok: true });
};

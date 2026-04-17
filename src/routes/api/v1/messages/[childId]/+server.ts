import { json } from '@sveltejs/kit';
import { messageQuerySchema, sendMessageSchema } from '$lib/domain/validation/message';
import { validationError } from '$lib/server/errors';
import {
	getMessageHistory,
	getUnshownMessage,
	getUnshownMessageCount,
	sendMessage,
} from '$lib/server/services/message-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const parsed = messageQuerySchema.safeParse({ childId: params.childId });
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const mode = url.searchParams.get('mode');

	if (mode === 'unshown') {
		const message = await getUnshownMessage(parsed.data.childId, tenantId);
		const count = await getUnshownMessageCount(parsed.data.childId, tenantId);
		return json({ message: message ?? null, unshownCount: count });
	}

	const limit = Number(url.searchParams.get('limit') ?? '20');
	const messages = await getMessageHistory(parsed.data.childId, tenantId, limit);
	return json({ messages });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();

	const parsed = sendMessageSchema.safeParse({
		...body,
		childId: params.childId,
	});
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const message = await sendMessage(parsed.data, tenantId);
	return json(message, { status: 201 });
};

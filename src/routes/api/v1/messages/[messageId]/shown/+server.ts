import { json } from '@sveltejs/kit';
import { notFound } from '$lib/server/errors';
import { markAsShown } from '$lib/server/services/message-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals, cookies }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const messageId = Number(params.messageId);
	if (!messageId || Number.isNaN(messageId)) {
		return notFound('メッセージが見つかりません');
	}

	// #2845 課題①: 呼び出し元は子供ホーム (selectedChildId cookie 必須)。childId を repo まで
	// 引き回し、(childId, messageId) 複合キーで所有権を検証する (id-only mutation 禁止)。
	const childId = Number(cookies.get('selectedChildId'));
	if (!childId || Number.isNaN(childId)) {
		return json({ error: 'こどもが選択されていません' }, { status: 400 });
	}

	const result = await markAsShown(childId, messageId, tenantId);
	if (!result) {
		return notFound('メッセージが見つかりません');
	}

	return json({ ok: true });
};

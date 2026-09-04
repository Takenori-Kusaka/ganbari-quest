import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { notFound } from '$lib/server/errors';
import { markAsShown } from '$lib/server/services/message-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals, cookies }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const messageId = params.messageId;
	if (!messageId) {
		return notFound('メッセージが見つかりません');
	}

	// #2845 課題①: 呼び出し元は子供ホーム (selectedChildId cookie 必須)。childId を repo まで
	// 引き回し、(childId, messageId) 複合キーで所有権を検証する (id-only mutation 禁止)。
	const childId = asChildId(cookies.get('selectedChildId') ?? '');
	if (!childId) {
		return json({ error: 'こどもが選択されていません' }, { status: 400 });
	}
	// cookie は client が書き換えられる。child ロールが兄弟の childId を cookie に入れて
	// 兄弟宛メッセージを既読にする (= 相手に届かなくする) のを止める。
	requireChildAccess(locals, childId);

	const result = await markAsShown(childId, messageId, tenantId);
	if (!result) {
		return notFound('メッセージが見つかりません');
	}

	return json({ ok: true });
};

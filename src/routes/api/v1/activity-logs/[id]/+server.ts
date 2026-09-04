import { json } from '@sveltejs/kit';
import { requireChildScope } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { cancelActivityLog } from '$lib/server/services/activity-log-service';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = params.id;
	if (!id) return validationError('IDが不正です');
	// path は logId しか持たないため、行の所有者を route では判定できない。「絞り込むべき child」
	// (child ロール = 自分 / owner・parent = null) を service に渡して突合させる。
	// これが無いと child ロールが兄弟の記録をとりけし、兄弟のポイントを削れる。
	const scopeChildId = requireChildScope(locals);

	const result = await cancelActivityLog(id, tenantId, scopeChildId);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', 'きろくがみつかりません');
		}
		if (result.error === 'CANCEL_EXPIRED') {
			return apiError('CANCEL_EXPIRED', 'キャンセル期限を過ぎています');
		}
	}

	return json({
		message: '記録をキャンセルしました',
		refundedPoints: result.refundedPoints,
	});
};

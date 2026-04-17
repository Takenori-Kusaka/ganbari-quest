import { json } from '@sveltejs/kit';
import { apiError, validationError } from '$lib/server/errors';
import { cancelActivityLog } from '$lib/server/services/activity-log-service';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const result = await cancelActivityLog(id, tenantId);

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

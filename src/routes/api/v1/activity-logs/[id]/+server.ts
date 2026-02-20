import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelActivityLog } from '$lib/server/services/activity-log-service';
import { apiError, validationError } from '$lib/server/errors';

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const result = cancelActivityLog(id);

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

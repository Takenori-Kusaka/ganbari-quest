import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convertPoints } from '$lib/server/services/point-service';
import { convertPointsSchema } from '$lib/domain/validation/point';
import { apiError, validationError } from '$lib/server/errors';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const parsed = convertPointsSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const result = convertPoints(parsed.data.childId, parsed.data.amount);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', 'こどもがみつかりません');
		}
		if (result.error === 'INSUFFICIENT_POINTS') {
			return apiError('INSUFFICIENT_POINTS', 'ポイントがたりません');
		}
	}

	return json(result);
};

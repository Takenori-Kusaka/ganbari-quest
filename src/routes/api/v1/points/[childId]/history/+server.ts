import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPointHistory } from '$lib/server/services/point-service';
import { pointHistoryQuerySchema } from '$lib/domain/validation/point';
import { notFound, validationError } from '$lib/server/errors';

export const GET: RequestHandler = async ({ params, url }) => {
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const parsed = pointHistoryQuerySchema.safeParse(
		Object.fromEntries(url.searchParams),
	);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const result = getPointHistory(childId, parsed.data);
	if ('error' in result) {
		return notFound('こどもがみつかりません');
	}

	return json(result);
};

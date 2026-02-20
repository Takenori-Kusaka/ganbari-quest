import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChildStatus } from '$lib/server/services/status-service';
import { notFound, validationError } from '$lib/server/errors';

export const GET: RequestHandler = async ({ params }) => {
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const result = getChildStatus(childId);
	if ('error' in result) {
		return notFound('こどもがみつかりません');
	}

	return json(result);
};

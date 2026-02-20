import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimLoginBonus } from '$lib/server/services/login-bonus-service';
import { apiError, validationError } from '$lib/server/errors';

export const POST: RequestHandler = async ({ params }) => {
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const result = claimLoginBonus(childId);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', 'こどもがみつかりません');
		}
		if (result.error === 'ALREADY_CLAIMED') {
			return apiError('ALREADY_CLAIMED', 'きょうのボーナスはもうもらったよ！');
		}
	}

	return json(result, { status: 201 });
};

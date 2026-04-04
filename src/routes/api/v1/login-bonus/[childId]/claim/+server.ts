import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { claimLoginBonus } from '$lib/server/services/login-bonus-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const result = await claimLoginBonus(childId, tenantId);

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

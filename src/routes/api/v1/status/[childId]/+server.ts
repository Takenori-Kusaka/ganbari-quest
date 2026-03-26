import { requireTenantId } from '$lib/server/auth/factory';
import { notFound, validationError } from '$lib/server/errors';
import { getChildStatus } from '$lib/server/services/status-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const result = await getChildStatus(childId, tenantId);
	if ('error' in result) {
		return notFound('こどもがみつかりません');
	}

	return json(result);
};

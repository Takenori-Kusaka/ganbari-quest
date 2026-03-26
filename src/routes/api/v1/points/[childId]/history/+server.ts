import { pointHistoryQuerySchema } from '$lib/domain/validation/point';
import { requireTenantId } from '$lib/server/auth/factory';
import { notFound, validationError } from '$lib/server/errors';
import { getPointHistory } from '$lib/server/services/point-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const parsed = pointHistoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const result = await getPointHistory(childId, parsed.data, tenantId);
	if ('error' in result) {
		return notFound('こどもがみつかりません');
	}

	return json(result);
};

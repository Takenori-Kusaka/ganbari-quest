import { json } from '@sveltejs/kit';
import { notFound, validationError } from '$lib/server/errors';
import { getPointBalance } from '$lib/server/services/point-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const result = await getPointBalance(childId, tenantId);
	if ('error' in result) {
		return notFound('こどもがみつかりません');
	}

	return json(result);
};

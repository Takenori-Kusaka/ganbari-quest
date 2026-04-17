import { json } from '@sveltejs/kit';
import { notFound, validationError } from '$lib/server/errors';
import { getAllChildren } from '$lib/server/services/child-service';
import { getChildEvaluations } from '$lib/server/services/evaluation-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const children = await getAllChildren(tenantId);
	const child = children.find((c) => c.id === childId);
	if (!child) return notFound('こどもがみつかりません');

	const limit = Number(url.searchParams.get('limit') ?? '10');
	const evaluations = await getChildEvaluations(childId, tenantId, limit);

	return json({ evaluations });
};

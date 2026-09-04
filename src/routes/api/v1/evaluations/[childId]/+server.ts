import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
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
	const childId = asChildId(params.childId);
	if (!childId) return validationError('IDが不正です');
	// child ロールは自分の週次評価のみ (兄弟の評価を読めない)。
	requireChildAccess(locals, childId);

	const children = await getAllChildren(tenantId);
	const child = children.find((c) => c.id === childId);
	if (!child) return notFound('こどもがみつかりません');

	const limit = Number(url.searchParams.get('limit') ?? '10');
	const evaluations = await getChildEvaluations(childId, tenantId, limit);

	return json({ evaluations });
};

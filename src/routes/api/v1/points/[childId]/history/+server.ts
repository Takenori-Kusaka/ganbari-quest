import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { pointHistoryQuerySchema } from '$lib/domain/validation/point';
import { requireChildAccess } from '$lib/server/auth/factory';
import { notFound, validationError } from '$lib/server/errors';
import { getPointHistory } from '$lib/server/services/point-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.childId);
	if (!childId) return validationError('IDが不正です');
	// child ロールは自分の履歴のみ (兄弟の記録を覗けない)。
	requireChildAccess(locals, childId);

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

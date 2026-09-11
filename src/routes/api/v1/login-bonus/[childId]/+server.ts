import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { notFound, validationError } from '$lib/server/errors';
import { getLoginBonusStatus } from '$lib/server/services/login-bonus-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.childId);
	if (!childId) return validationError('IDが不正です');
	// child ロールは自分のボーナス状態のみ。
	requireChildAccess(locals, childId);

	const result = await getLoginBonusStatus(childId, tenantId);
	if ('error' in result) {
		return notFound('こどもがみつかりません');
	}

	return json(result);
};

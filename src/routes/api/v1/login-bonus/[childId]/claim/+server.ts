import { json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { CHILD_ACTION_ERROR_LABELS } from '$lib/domain/labels';
import { requireChildAccess } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { claimLoginBonus } from '$lib/server/services/login-bonus-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.childId);
	if (!childId) return validationError('IDが不正です');
	// child ロールは自分の分しか受け取れない (兄弟のログインボーナスの先取り防止)。
	requireChildAccess(locals, childId);

	const result = await claimLoginBonus(childId, tenantId);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', 'こどもがみつかりません');
		}
		if (result.error === 'ALREADY_CLAIMED') {
			return apiError('ALREADY_CLAIMED', CHILD_ACTION_ERROR_LABELS.bonusAlreadyClaimed);
		}
	}

	return json(result, { status: 201 });
};

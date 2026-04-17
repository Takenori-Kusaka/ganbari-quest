import { json } from '@sveltejs/kit';
import { updateActivitySchema } from '$lib/domain/validation/activity';
import { notFound, validationError } from '$lib/server/errors';
import {
	getActivityById,
	setActivityVisibility,
	updateActivity,
} from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const activity = await getActivityById(id, tenantId);
	if (!activity) return notFound('かつどうがみつかりません');

	return json(activity);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	const parsed = updateActivitySchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const updated = await updateActivity(id, parsed.data, tenantId);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	// Soft delete: set visibility to false
	await setActivityVisibility(id, false, tenantId);
	return json({ message: '非表示にしました' });
};

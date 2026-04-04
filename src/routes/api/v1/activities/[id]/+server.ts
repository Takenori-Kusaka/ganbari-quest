import { json } from '@sveltejs/kit';
import { updateActivitySchema } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { notFound, validationError } from '$lib/server/errors';
import {
	getActivityById,
	setActivityVisibility,
	updateActivity,
} from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const activity = await getActivityById(id, tenantId);
	if (!activity) return notFound('かつどうがみつかりません');

	return json(activity);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
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
	const tenantId = requireTenantId(locals);
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	// Soft delete: set visibility to false
	await setActivityVisibility(id, false, tenantId);
	return json({ message: '非表示にしました' });
};

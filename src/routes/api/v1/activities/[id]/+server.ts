import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { asActivityId } from '$lib/domain/ids';
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
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

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
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	const parsed = v.safeParse(updateActivitySchema, body);
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? '入力が不正です');
	}

	const updated = await updateActivity(id, parsed.output, tenantId);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const id = asActivityId(params.id);
	if (!id) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	// Soft delete: set visibility to false
	await setActivityVisibility(id, false, tenantId);
	return json({ message: '非表示にしました' });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getActivityById,
	updateActivity,
	setActivityVisibility,
} from '$lib/server/services/activity-service';
import { updateActivitySchema } from '$lib/domain/validation/activity';
import { notFound, validationError } from '$lib/server/errors';

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const activity = getActivityById(id);
	if (!activity) return notFound('かつどうがみつかりません');

	return json(activity);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = getActivityById(id);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	const parsed = updateActivitySchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const updated = updateActivity(id, parsed.data);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = getActivityById(id);
	if (!existing) return notFound('かつどうがみつかりません');

	// Soft delete: set visibility to false
	setActivityVisibility(id, false);
	return json({ message: '非表示にしました' });
};

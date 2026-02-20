import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getActivityById,
	setActivityVisibility,
} from '$lib/server/services/activity-service';
import { notFound, validationError } from '$lib/server/errors';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = getActivityById(id);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	if (typeof body.isVisible !== 'boolean') {
		return validationError('isVisible は true/false で指定してください');
	}

	const updated = setActivityVisibility(id, body.isVisible);
	return json(updated);
};

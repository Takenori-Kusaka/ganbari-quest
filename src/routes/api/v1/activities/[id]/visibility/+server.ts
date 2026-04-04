import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { notFound, validationError } from '$lib/server/errors';
import { getActivityById, setActivityVisibility } from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const id = Number(params.id);
	if (Number.isNaN(id)) return validationError('IDが不正です');

	const existing = await getActivityById(id, tenantId);
	if (!existing) return notFound('かつどうがみつかりません');

	const body = await request.json();
	if (typeof body.isVisible !== 'boolean') {
		return validationError('isVisible は true/false で指定してください');
	}

	const updated = await setActivityVisibility(id, body.isVisible, tenantId);
	return json(updated);
};

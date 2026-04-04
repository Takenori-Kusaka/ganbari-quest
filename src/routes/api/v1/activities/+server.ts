import { json } from '@sveltejs/kit';
import { activitiesQuerySchema, createActivitySchema } from '$lib/domain/validation/activity';
import { requireTenantId } from '$lib/server/auth/factory';
import { findChildById } from '$lib/server/db/activity-repo';
import { validationError } from '$lib/server/errors';
import { createActivity, getActivities } from '$lib/server/services/activity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	const parsed = activitiesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	let childAge: number | undefined;
	if (parsed.data.childId) {
		const child = await findChildById(parsed.data.childId, tenantId);
		if (child) childAge = child.age;
	}

	const result = await getActivities(tenantId, {
		childAge,
		categoryId: parsed.data.categoryId,
		includeHidden: parsed.data.includeHidden,
	});

	return json({ activities: result });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	const body = await request.json();
	const parsed = createActivitySchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const activity = await createActivity(parsed.data, tenantId);
	return json(activity, { status: 201 });
};

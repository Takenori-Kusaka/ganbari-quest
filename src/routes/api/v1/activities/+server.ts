import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getActivities,
	createActivity,
} from '$lib/server/services/activity-service';
import {
	activitiesQuerySchema,
	createActivitySchema,
} from '$lib/domain/validation/activity';
import { validationError } from '$lib/server/errors';
import { findChildById } from '$lib/server/db/activity-repo';

export const GET: RequestHandler = async ({ url }) => {
	const parsed = activitiesQuerySchema.safeParse(
		Object.fromEntries(url.searchParams),
	);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	let childAge: number | undefined;
	if (parsed.data.childId) {
		const child = findChildById(parsed.data.childId);
		if (child) childAge = child.age;
	}

	const result = getActivities({
		childAge,
		category: parsed.data.category,
		includeHidden: parsed.data.includeHidden,
	});

	return json({ activities: result });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const parsed = createActivitySchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const activity = createActivity(parsed.data);
	return json(activity, { status: 201 });
};

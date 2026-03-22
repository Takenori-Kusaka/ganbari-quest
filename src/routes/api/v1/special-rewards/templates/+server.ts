import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { validationError } from '$lib/server/errors';
import {
	getRewardTemplates,
	saveRewardTemplates,
} from '$lib/server/services/special-reward-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const templates = await getRewardTemplates();
	return json({ templates });
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();

	const parsed = rewardTemplatesArraySchema.safeParse(body.templates ?? body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'テンプレートデータが不正です');
	}

	await saveRewardTemplates(parsed.data);
	return json({ templates: parsed.data });
};

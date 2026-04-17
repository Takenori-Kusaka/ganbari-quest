import { json } from '@sveltejs/kit';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { validationError } from '$lib/server/errors';
import {
	getRewardTemplates,
	saveRewardTemplates,
} from '$lib/server/services/special-reward-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const templates = await getRewardTemplates(tenantId);
	return json({ templates });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();

	const parsed = rewardTemplatesArraySchema.safeParse(body.templates ?? body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'テンプレートデータが不正です');
	}

	await saveRewardTemplates(parsed.data, tenantId);
	return json({ templates: parsed.data });
};

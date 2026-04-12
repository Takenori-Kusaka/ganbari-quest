// src/routes/api/v1/checklists/suggest/+server.ts
// AI チェックリスト提案 API — プランゲート必須 (#720)

import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/errors';
import { suggestChecklist } from '$lib/server/services/checklist-suggest-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.context) {
		throw error(401, { message: 'Unauthorized' });
	}
	const tenantId = locals.context.tenantId;

	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	if (!isPaidTier(tier)) {
		return apiError(
			'PLAN_LIMIT_EXCEEDED',
			'AI チェックリスト提案はスタンダードプラン以上でご利用いただけます',
		);
	}

	const body = await request.json();
	const text = String(body.text ?? '').trim();

	if (!text) {
		throw error(400, { message: 'テキストを入力してください' });
	}

	if (text.length > 200) {
		throw error(400, { message: 'テキストは200文字以内にしてください' });
	}

	const suggestion = await suggestChecklist(text);
	return json(suggestion);
};

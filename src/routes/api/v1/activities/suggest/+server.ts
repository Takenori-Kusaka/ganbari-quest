// src/routes/api/v1/activities/suggest/+server.ts
// AI 活動提案 API — プランゲート必須 (#727)

import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { suggestActivity } from '$lib/server/services/activity-suggest-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	// #727: 認証必須 — unauthenticated 呼び出しを完全に遮断
	const tenantId = requireTenantId(locals);

	// #727: プランゲート — 無料プランは AI 提案を利用不可（コスト流出防止）
	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	if (!isPaidTier(tier)) {
		return apiError(
			'PLAN_LIMIT_EXCEEDED',
			'AI 活動提案はスタンダードプラン以上でご利用いただけます',
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

	const suggestion = await suggestActivity(text);
	return json(suggestion);
};

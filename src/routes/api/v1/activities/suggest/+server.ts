// src/routes/api/v1/activities/suggest/+server.ts
// AI 活動提案 API — プランゲート必須 (#727)

import { json } from '@sveltejs/kit';
import { validateSuggestRequest } from '$lib/server/api/suggest-plan-gate';
import { suggestActivity } from '$lib/server/services/activity-suggest-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const result = await validateSuggestRequest(locals, request, 'AI 活動提案');
	if (!result.ok) return result.response;

	const suggestion = await suggestActivity(result.text);
	return json(suggestion);
};

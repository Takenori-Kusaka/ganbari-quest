// src/routes/api/v1/special-rewards/suggest/+server.ts
// AI ごほうび提案 API — プランゲート必須 (#719)

import { json } from '@sveltejs/kit';
import { validateSuggestRequest } from '$lib/server/api/suggest-plan-gate';
import { suggestReward } from '$lib/server/services/reward-suggest-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const result = await validateSuggestRequest(locals, request, 'AI ごほうび提案');
	if (!result.ok) return result.response;

	const suggestion = await suggestReward(result.text);
	return json(suggestion);
};

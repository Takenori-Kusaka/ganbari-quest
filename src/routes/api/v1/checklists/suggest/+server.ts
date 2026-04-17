// src/routes/api/v1/checklists/suggest/+server.ts
// AI チェックリスト提案 API — プランゲート必須 (#720)

import { json } from '@sveltejs/kit';
import { validateSuggestRequest } from '$lib/server/api/suggest-plan-gate';
import { suggestChecklist } from '$lib/server/services/checklist-suggest-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const result = await validateSuggestRequest(locals, request, 'AI チェックリスト提案');
	if (!result.ok) return result.response;

	const suggestion = await suggestChecklist(result.text);
	return json(suggestion);
};

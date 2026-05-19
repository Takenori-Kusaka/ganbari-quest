// src/routes/api/v1/cheer/suggest/+server.ts
// AI 応援提案 API — family プラン限定 (#2273)
//
// 既存 LLM 連携機構 (special-rewards/suggest と同基盤) を再利用。
// 共通プランゲート (validateSuggestRequest) で family 以外を 403 PLAN_LIMIT_EXCEEDED に変換。

import { json } from '@sveltejs/kit';
import { validateSuggestRequest } from '$lib/server/api/suggest-plan-gate';
import { suggestCheer } from '$lib/server/services/cheer-suggest-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const result = await validateSuggestRequest(locals, request, 'AI 応援提案');
	if (!result.ok) return result.response;

	const suggestion = await suggestCheer(result.text);
	return json(suggestion);
};

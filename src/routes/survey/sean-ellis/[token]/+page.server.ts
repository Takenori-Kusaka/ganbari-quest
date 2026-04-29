// src/routes/survey/sean-ellis/[token]/+page.server.ts
// #1598 (ADR-0023 §5 I7): PMF 判定アンケート (Sean Ellis Test) 回答ページ。
//
// メール本文のリンクから認証なしで回答できる (HMAC トークンが認証代わり)。
// 回答は settings KV (`pmf_survey_response_<round>`) に保存され、
// ops/pmf-survey で集計表示される。
//
// 重複回答ガード:
//   - 同一 (tenantId × round) で再アクセスすると alreadyAnswered: true を返す
//   - 上書きはせず「回答済みです」表示

import { fail } from '@sveltejs/kit';
import type { PmfSurveyQ1, PmfSurveyQ3 } from '$lib/domain/labels';
import {
	hasAnsweredSurvey,
	type PmfSurveyResponse,
	saveSurveyResponse,
} from '$lib/server/services/pmf-survey-service';
import { verifySurveyToken } from '$lib/server/services/survey-token';
import type { Actions, PageServerLoad } from './$types';

const VALID_Q1: PmfSurveyQ1[] = ['very', 'somewhat', 'not', 'na'];
const VALID_Q3: PmfSurveyQ3[] = ['lp', 'media', 'friend', 'google', 'sns', 'other'];

export const load: PageServerLoad = async ({ params }) => {
	const payload = verifySurveyToken(params.token);
	if (!payload) {
		return {
			tokenValid: false as const,
			alreadyAnswered: false,
			round: '',
		};
	}

	const alreadyAnswered = await hasAnsweredSurvey(payload.tenantId, payload.round);
	return {
		tokenValid: true as const,
		alreadyAnswered,
		round: payload.round,
	};
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const payload = verifySurveyToken(params.token);
		if (!payload) {
			return fail(400, { error: 'invalid-token' });
		}

		const already = await hasAnsweredSurvey(payload.tenantId, payload.round);
		if (already) {
			// 上書きはしない (重複送信は無視して成功扱い)。
			return { success: true };
		}

		const formData = await request.formData();
		const q1Raw = formData.get('q1');
		const q2Raw = formData.get('q2');
		const q3Raw = formData.get('q3');
		const q4Raw = formData.get('q4');

		const q1 = typeof q1Raw === 'string' ? q1Raw : '';
		const q3 = typeof q3Raw === 'string' ? q3Raw : '';
		if (!VALID_Q1.includes(q1 as PmfSurveyQ1)) {
			return fail(400, { error: 'invalid-q1' });
		}
		if (!VALID_Q3.includes(q3 as PmfSurveyQ3)) {
			return fail(400, { error: 'invalid-q3' });
		}

		const response: PmfSurveyResponse = {
			tenantId: payload.tenantId,
			round: payload.round,
			q1: q1 as PmfSurveyQ1,
			q2: typeof q2Raw === 'string' ? q2Raw.trim().slice(0, 1000) : '',
			q3: q3 as PmfSurveyQ3,
			q4: typeof q4Raw === 'string' ? q4Raw.trim().slice(0, 1000) : '',
			answeredAt: new Date().toISOString(),
		};

		await saveSurveyResponse(response);
		return { success: true };
	},
};

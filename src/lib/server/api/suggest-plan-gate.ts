// src/lib/server/api/suggest-plan-gate.ts
// AI 提案エンドポイント共通プランゲート (#727)

import { error } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { apiError } from '$lib/server/errors';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';

interface PlanGateSuccess {
	ok: true;
	tenantId: string;
	text: string;
}

interface PlanGateFailure {
	ok: false;
	response: Response;
}

/**
 * AI 提案エンドポイント共通のプランゲートとバリデーションを実行する。
 *
 * 1. 認証チェック（未認証 → 401）
 * 2. プランチェック（family 以外 → PLAN_LIMIT_EXCEEDED）
 * 3. テキストバリデーション（空 → 400, 200文字超 → 400）
 *
 * @returns 成功時は { ok: true, tenantId, text }, 失敗時は { ok: false, response }
 */
export async function validateSuggestRequest(
	locals: App.Locals,
	request: Request,
	featureLabel: string,
): Promise<PlanGateSuccess | PlanGateFailure> {
	if (!locals.context) {
		throw error(401, { message: 'Unauthorized' });
	}
	const tenantId = locals.context.tenantId;

	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	if (tier !== 'family') {
		return {
			ok: false,
			response: apiError(
				'PLAN_LIMIT_EXCEEDED',
				`${featureLabel}はファミリープランでご利用いただけます`,
			),
		};
	}

	const body = await request.json();
	const text = String(body.text ?? '').trim();

	if (!text) {
		throw error(400, { message: 'テキストを入力してください' });
	}

	if (text.length > 200) {
		throw error(400, { message: 'テキストは200文字以内にしてください' });
	}

	return { ok: true, tenantId, text };
}

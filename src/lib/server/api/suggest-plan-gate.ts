// src/lib/server/api/suggest-plan-gate.ts
// AI 提案エンドポイント共通プランゲート (#727)

import { error } from '@sveltejs/kit';
import { isAiSuggestUnlocked } from '$lib/domain/ai-suggest-gate';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { planLimitError } from '$lib/server/errors';
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
	// #4506: UI 側のロック表示と同一述語 ($lib/domain/ai-suggest-gate) を使う。
	// enforcement と表示が別式だったために「表示の嘘」が 3 画面で発生した。
	if (!isAiSuggestUnlocked(tier)) {
		return {
			ok: false,
			// #4710: AI 提案は premium 限定。standard 契約者に「スタンダード以上に」と言わない。
			response: planLimitError('family', PLAN_GATE_LABELS.familyOnlyFor(featureLabel)),
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

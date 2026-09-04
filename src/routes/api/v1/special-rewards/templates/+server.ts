import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { isCustomRewardUnlocked } from '$lib/domain/custom-reward-gate';
import { REWARD_TERMS } from '$lib/domain/terms';
import { rewardTemplatesArraySchema } from '$lib/domain/validation/special-reward';
import { planLimitError, validationError } from '$lib/server/errors';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
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

	// #4705: プリセット (ショップ商品の雛形) の保存も有料プランの機能。GET (閲覧) は無料でも通す。
	const tier = await resolveFullPlanTier(
		tenantId,
		context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		context.plan,
	);
	if (!isCustomRewardUnlocked(tier)) {
		// #4767 PO 回答 #4: 顧客に届く文言は errors.ts が機能名 + tier + 導線で 1 本に組み立てる
		return planLimitError('standard', REWARD_TERMS.productRegistration, { tenantId, tier });
	}

	const body = await request.json();

	const parsed = v.safeParse(rewardTemplatesArraySchema, body.templates ?? body);
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? 'テンプレートデータが不正です');
	}

	await saveRewardTemplates(parsed.output, tenantId);
	return json({ templates: parsed.output });
};

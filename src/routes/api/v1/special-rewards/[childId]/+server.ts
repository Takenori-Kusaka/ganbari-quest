import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { isCustomRewardUnlocked } from '$lib/domain/custom-reward-gate';
import {
	grantSpecialRewardSchema,
	specialRewardQuerySchema,
} from '$lib/domain/validation/special-reward';
import { notFound, planLimitError, validationError } from '$lib/server/errors';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import {
	getChildSpecialRewards,
	grantSpecialReward,
} from '$lib/server/services/special-reward-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const parsed = v.safeParse(specialRewardQuerySchema, { childId: params.childId });
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? 'パラメータが不正です');
	}

	const result = await getChildSpecialRewards(parsed.output.childId, tenantId);
	return json(result);
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	// #4705: ごほうび (ショップ商品) の登録は有料プランの機能。form action 側 (#4584) にしか
	// gate が無く、本 endpoint は無料プランのまま 201 を返していた。**同じ述語**を読む。
	const tier = await resolveFullPlanTier(
		tenantId,
		context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		context.plan,
	);
	if (!isCustomRewardUnlocked(tier)) {
		return planLimitError('standard', 'special reward grant requires standard or above', {
			tenantId,
			tier,
		});
	}

	const body = await request.json();

	const parsed = v.safeParse(grantSpecialRewardSchema, {
		...body,
		childId: params.childId,
	});
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? '入力が不正です');
	}

	const result = await grantSpecialReward(parsed.output, tenantId);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return notFound('こどもがみつかりません');
		}
	}

	return json(result, { status: 201 });
};

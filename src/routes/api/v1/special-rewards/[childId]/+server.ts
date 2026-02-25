import {
	grantSpecialRewardSchema,
	specialRewardQuerySchema,
} from '$lib/domain/validation/special-reward';
import { notFound, validationError } from '$lib/server/errors';
import {
	getChildSpecialRewards,
	grantSpecialReward,
} from '$lib/server/services/special-reward-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const parsed = specialRewardQuerySchema.safeParse({ childId: params.childId });
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const result = getChildSpecialRewards(parsed.data.childId);
	return json(result);
};

export const POST: RequestHandler = async ({ request, params }) => {
	const body = await request.json();

	const parsed = grantSpecialRewardSchema.safeParse({
		...body,
		childId: params.childId,
	});
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	const result = grantSpecialReward(parsed.data);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return notFound('こどもがみつかりません');
		}
	}

	return json(result, { status: 201 });
};

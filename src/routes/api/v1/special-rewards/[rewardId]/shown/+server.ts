import { error, json } from '@sveltejs/kit';
import { markRewardShown } from '$lib/server/services/special-reward-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const rewardId = Number(params.rewardId);
	if (Number.isNaN(rewardId)) {
		error(400, 'Invalid reward ID');
	}

	const success = await markRewardShown(rewardId, tenantId);
	if (!success) {
		error(404, 'Reward not found');
	}

	return json({ success: true });
};

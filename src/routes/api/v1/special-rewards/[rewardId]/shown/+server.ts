import { requireTenantId } from '$lib/server/auth/factory';
import { markRewardShown } from '$lib/server/services/special-reward-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
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

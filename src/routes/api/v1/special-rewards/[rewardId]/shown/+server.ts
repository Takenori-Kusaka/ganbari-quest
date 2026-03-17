import { markRewardShown } from '$lib/server/services/special-reward-service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	const rewardId = Number(params.rewardId);
	if (Number.isNaN(rewardId)) {
		error(400, 'Invalid reward ID');
	}

	const success = markRewardShown(rewardId);
	if (!success) {
		error(404, 'Reward not found');
	}

	return json({ success: true });
};

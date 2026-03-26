import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	getChildSpecialRewards,
	getRewardTemplates,
	grantSpecialReward,
} from '$lib/server/services/special-reward-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	const templates = await getRewardTemplates(tenantId);

	const childrenWithRewards = await Promise.all(
		children.map(async (child) => {
			const rewards = await getChildSpecialRewards(child.id, tenantId);
			return {
				...child,
				rewardCount: rewards.rewards.length,
				totalRewardPoints: rewards.totalPoints,
			};
		}),
	);

	return { children: childrenWithRewards, templates };
};

export const actions: Actions = {
	grant: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? 'other');

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!title) return fail(400, { error: 'タイトルを入力してください' });
		if (points <= 0 || points > 10000) return fail(400, { error: 'ポイントは1〜10000の範囲です' });

		const result = await grantSpecialReward({ childId, title, points, icon, category }, tenantId);
		if ('error' in result) {
			return fail(400, { error: result.error });
		}

		return { granted: true, reward: result };
	},
};

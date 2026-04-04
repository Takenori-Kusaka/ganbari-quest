// /admin/rewards — 統合報酬ハブ「こどもを褒める」(#336)

import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import { STAMP_PRESETS, sendMessage } from '$lib/server/services/message-service';
import {
	getChildSpecialRewards,
	getRewardTemplates,
	grantSpecialReward,
} from '$lib/server/services/special-reward-service';
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

	return {
		children: childrenWithRewards,
		templates,
		stampPresets: STAMP_PRESETS,
	};
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

	sendStamp: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const stampCode = String(formData.get('stampCode') ?? '');

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!stampCode) return fail(400, { error: 'スタンプを選択してください' });

		await sendMessage({ childId, messageType: 'stamp', stampCode }, tenantId);

		return { stampSent: true };
	},

	sendText: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const body = String(formData.get('body') ?? '').trim();

		if (!childId) return fail(400, { error: 'こどもを選択してください' });
		if (!body) return fail(400, { error: 'メッセージを入力してください' });
		if (body.length > 200) return fail(400, { error: 'メッセージは200文字以内です' });

		await sendMessage({ childId, messageType: 'text', body }, tenantId);

		return { messageSent: true };
	},
};

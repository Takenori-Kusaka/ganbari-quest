// /admin/rewards — 特別報酬の付与（#336, #501, #581 プリセット追加, #728 プランゲート, #787 PlanLimitError 統一）

import { fail } from '@sveltejs/kit';
import { PRESET_REWARD_GROUPS } from '$lib/data/preset-rewards';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	isPaidTier,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import {
	getChildSpecialRewards,
	getRewardTemplates,
	grantSpecialReward,
	type RewardTemplate,
	saveRewardTemplates,
} from '$lib/server/services/special-reward-service';
import type { Actions, PageServerLoad } from './$types';

const UPGRADE_MESSAGE = '特別なごほうび設定はスタンダードプラン以上でご利用いただけます';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	const isPremium = isPaidTier(tier);

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
		presetGroups: PRESET_REWARD_GROUPS,
		isPremium,
		planTier: tier,
	};
};

/** 現在のプラン tier を解決して返すヘルパー (#787) */
async function resolveTier(locals: App.Locals, tenantId: string): Promise<PlanTier> {
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	return resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
}

export const actions: Actions = {
	grant: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはカスタム報酬付与不可
		// #787: PlanLimitError 形式に統一
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

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

	addPreset: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);

		// #728: プランゲート — 無料プランはプリセットの取り込みも不可
		// #787: PlanLimitError 形式に統一
		const tier = await resolveTier(locals, tenantId);
		if (!isPaidTier(tier)) {
			return fail(403, {
				error: createPlanLimitError(tier, 'standard', UPGRADE_MESSAGE),
			});
		}

		const formData = await request.formData();
		const title = String(formData.get('title') ?? '').trim();
		const points = Number(formData.get('points') ?? 0);
		const icon = String(formData.get('icon') ?? '🎁');
		const category = String(formData.get('category') ?? 'other');

		if (!title || points <= 0) return fail(400, { error: 'プリセットデータが不正です' });

		const existing = await getRewardTemplates(tenantId);
		if (existing.some((t) => t.title === title)) {
			return { presetAdded: true };
		}

		const newTemplate: RewardTemplate = {
			title,
			points,
			icon,
			category: category as RewardTemplate['category'],
		};
		await saveRewardTemplates([...existing, newTemplate], tenantId);

		return { presetAdded: true };
	},
};

import { requireTenantId } from '$lib/server/auth/factory';
import type { CustomAchievementConditionType } from '$lib/server/db/types';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	createCustomAchievement,
	getCustomAchievementsForChild,
	removeCustomAchievement,
} from '$lib/server/services/custom-achievement-service';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	const isPremium = isPaidTier(planTier);

	const childrenWithData = await Promise.all(
		children.map(async (child) => {
			const customAchievements = await getCustomAchievementsForChild(child.id, tenantId);
			return {
				...child,
				customAchievements,
			};
		}),
	);

	return { children: childrenWithData, isPremium, planTier };
};

export const actions = {
	createCustomAchievement: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const icon = String(form.get('icon') ?? '🏅');
		const conditionType = String(form.get('conditionType')) as CustomAchievementConditionType;
		const conditionValue = Number(form.get('conditionValue'));
		const conditionActivityId = form.get('conditionActivityId')
			? Number(form.get('conditionActivityId'))
			: undefined;
		const conditionCategoryId = form.get('conditionCategoryId')
			? Number(form.get('conditionCategoryId'))
			: undefined;
		const bonusPoints = Number(form.get('bonusPoints') ?? 100);

		if (!childId || !name || !conditionValue) {
			return fail(400, { error: '必須項目を入力してください' });
		}

		const licenseStatus = locals.context?.licenseStatus ?? 'none';
		const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);

		const result = await createCustomAchievement(
			{
				childId,
				name,
				description: description || undefined,
				icon,
				conditionType,
				conditionValue,
				conditionActivityId,
				conditionCategoryId,
				bonusPoints,
			},
			tenantId,
			planTier,
		);

		if ('error' in result) {
			const messages: Record<string, string> = {
				LIMIT_REACHED: 'カスタム実績の上限に達しています',
				INVALID_INPUT: '入力内容を確認してください',
			};
			return fail(400, { error: messages[result.error] ?? 'エラーが発生しました' });
		}

		return { customCreated: true };
	},

	deleteCustomAchievement: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'IDが無効です' });
		await removeCustomAchievement(id, tenantId);
		return { customDeleted: true };
	},
} satisfies Actions;

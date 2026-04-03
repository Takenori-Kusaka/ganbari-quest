import { requireTenantId } from '$lib/server/auth/factory';
import { findAllAchievements } from '$lib/server/db/achievement-repo';
import type { CustomAchievementConditionType } from '$lib/server/db/types';
import { getChildAchievements, grantLifeEvent } from '$lib/server/services/achievement-service';
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
	const allAchievements = await findAllAchievements(tenantId);

	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	const isPremium = isPaidTier(planTier);

	const childrenWithAchievements = await Promise.all(
		children.map(async (child) => {
			const [achievements, customAchievements] = await Promise.all([
				getChildAchievements(child.id, tenantId),
				getCustomAchievementsForChild(child.id, tenantId),
			]);
			const unlockedCount = achievements.filter(
				(a) => a.unlockedAt !== null || a.highestUnlockedMilestone !== null,
			).length;
			return {
				...child,
				achievements,
				unlockedCount,
				totalCount: achievements.length,
				customAchievements,
			};
		}),
	);

	// ライフイベント実績一覧
	const lifeEvents = allAchievements.filter((a) => a.isMilestone === 1);

	return { children: childrenWithAchievements, lifeEvents, isPremium, planTier };
};

export const actions = {
	grantLifeEvent: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const childId = Number(form.get('childId'));
		const achievementId = Number(form.get('achievementId'));

		if (!childId || !achievementId) {
			return fail(400, { error: '子供と実績を選択してください' });
		}

		const result = await grantLifeEvent(childId, achievementId, tenantId);
		if ('error' in result) {
			const messages: Record<string, string> = {
				ACHIEVEMENT_NOT_FOUND: '実績が見つかりません',
				NOT_A_LIFE_EVENT: 'ライフイベント実績ではありません',
				ALREADY_UNLOCKED: 'すでに付与済みです',
			};
			return fail(400, { error: messages[result.error] ?? 'エラーが発生しました' });
		}

		return { granted: true, bonusPoints: result.bonusPoints };
	},

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

import { requireTenantId } from '$lib/server/auth/factory';
import { findAllAchievements } from '$lib/server/db/achievement-repo';
import { getChildAchievements, grantLifeEvent } from '$lib/server/services/achievement-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	const allAchievements = await findAllAchievements(tenantId);

	const childrenWithAchievements = await Promise.all(
		children.map(async (child) => {
			const achievements = await getChildAchievements(child.id, tenantId);
			const unlockedCount = achievements.filter(
				(a) => a.unlockedAt !== null || a.highestUnlockedMilestone !== null,
			).length;
			return {
				...child,
				achievements,
				unlockedCount,
				totalCount: achievements.length,
			};
		}),
	);

	// ライフイベント実績一覧
	const lifeEvents = allAchievements.filter((a) => a.isMilestone === 1);

	return { children: childrenWithAchievements, lifeEvents };
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
} satisfies Actions;

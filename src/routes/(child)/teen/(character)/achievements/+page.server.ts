import { requireTenantId } from '$lib/server/auth/factory';
import { getChildAchievements } from '$lib/server/services/achievement-service';
import { getCustomAchievementsForChild } from '$lib/server/services/custom-achievement-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { achievements: [], customAchievements: [] };

	const [achievements, customAchievements] = await Promise.all([
		getChildAchievements(child.id, tenantId),
		getCustomAchievementsForChild(child.id, tenantId),
	]);
	return { achievements, customAchievements };
};

import { requireTenantId } from '$lib/server/auth/factory';
import { getChildAchievements } from '$lib/server/services/achievement-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { achievements: [] };

	const achievements = await getChildAchievements(child.id, tenantId);
	return { achievements };
};

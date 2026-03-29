import { requireTenantId } from '$lib/server/auth/factory';
import { getSkillTree } from '$lib/server/services/skill-service';
import { getCategoryXpSummary } from '$lib/server/services/status-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { skillTree: null };

	const xpSummary = await getCategoryXpSummary(child.id, tenantId);
	const categoryLevels: Record<number, number> = {};
	if (xpSummary) {
		for (const [catId, info] of Object.entries(xpSummary)) {
			categoryLevels[Number(catId)] = info.level;
		}
	}

	const skillTree = await getSkillTree(child.id, categoryLevels, tenantId);

	return { skillTree };
};

import { getChildAchievements } from '$lib/server/services/achievement-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { achievements: [] };

	const achievements = await getChildAchievements(child.id);
	return { achievements };
};

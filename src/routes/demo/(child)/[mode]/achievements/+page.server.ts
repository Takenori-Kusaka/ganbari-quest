import { getDemoAchievementsData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { achievements: [] };
	return { achievements: getDemoAchievementsData(child.id) };
};

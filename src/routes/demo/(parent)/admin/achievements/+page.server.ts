import { getDemoAchievementsData, getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();

	const lifeEvents = [
		{ id: 101, name: '保育園卒園', icon: '🎓', bonusPoints: 500 },
		{ id: 102, name: '小学校入学', icon: '🏫', bonusPoints: 500 },
		{ id: 103, name: '小学校卒業', icon: '🎓', bonusPoints: 1000 },
		{ id: 104, name: '中学校入学', icon: '🏫', bonusPoints: 1000 },
	];

	const children = adminData.children.map((child) => {
		const achievements = getDemoAchievementsData(child.id);
		return {
			id: child.id,
			nickname: child.nickname,
			unlockedCount: achievements.filter((a) => a.unlockedAt !== null).length,
			totalCount: achievements.length,
			achievements,
		};
	});

	return { children, lifeEvents };
};

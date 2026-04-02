import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const reports = [
		{
			childId: 1,
			childName: 'ゆうと',
			weekStart: '2026-03-24',
			weekEnd: '2026-03-30',
			totalActivities: 12,
			totalPoints: 180,
			categories: [
				{
					categoryId: 1,
					categoryName: 'うんどう',
					categoryIcon: '🏃',
					activityCount: 4,
					totalPoints: 60,
					level: 4,
					levelTitle: 'すすむ冒険者',
					totalXp: 150,
				},
				{
					categoryId: 2,
					categoryName: 'べんきょう',
					categoryIcon: '📚',
					activityCount: 3,
					totalPoints: 45,
					level: 3,
					levelTitle: 'めざめし者',
					totalXp: 80,
				},
				{
					categoryId: 3,
					categoryName: 'おてつだい',
					categoryIcon: '🏠',
					activityCount: 3,
					totalPoints: 45,
					level: 5,
					levelTitle: 'たつじん',
					totalXp: 250,
				},
				{
					categoryId: 4,
					categoryName: 'こうりゅう',
					categoryIcon: '🤝',
					activityCount: 1,
					totalPoints: 15,
					level: 2,
					levelTitle: 'はじまりの一歩',
					totalXp: 40,
				},
				{
					categoryId: 5,
					categoryName: 'そうぞう',
					categoryIcon: '🎨',
					activityCount: 1,
					totalPoints: 15,
					level: 2,
					levelTitle: 'はじまりの一歩',
					totalXp: 35,
				},
			],
			highlights: [
				{ type: 'activity_top', message: '「うんどう」を4かい きろくしたよ！', icon: '🏃' },
				{ type: 'all_category', message: '5つのカテゴリで かつどうしたよ', icon: '⭐' },
				{ type: 'streak', message: 'こんしゅうは 12かい きろくしたよ', icon: '💪' },
			],
			advice: {
				message: '「こうりゅう」を もうすこし がんばると バランスが よくなるよ',
				suggestedCategory: 'こうりゅう',
			},
			newAchievements: [
				{ name: 'ウィークリーチャレンジャー', icon: '📅', description: '1週間で7回以上記録' },
			],
		},
	];

	return { reports };
};

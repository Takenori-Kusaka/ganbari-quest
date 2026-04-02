import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const events = [
		{
			id: 1,
			code: 'spring-2026',
			name: 'しんがっきスタートダッシュ',
			description: '新学期の目標を立てて活動しよう！',
			eventType: 'seasonal',
			startDate: '2026-04-01',
			endDate: '2026-04-30',
			bannerIcon: '🌸',
			bannerColor: 'linear-gradient(135deg, #fef3c7, #fde68a)',
			rewardConfig: '{"points":50,"title":"スタートダッシュ達成！"}',
			isActive: 1,
		},
		{
			id: 2,
			code: 'monthly-2026-04',
			name: 'まんすりーチャレンジ 4月',
			description: '今月30回記録しよう',
			eventType: 'monthly',
			startDate: '2026-04-01',
			endDate: '2026-04-30',
			bannerIcon: '📅',
			bannerColor: null,
			rewardConfig: '{"points":30}',
			isActive: 1,
		},
	];

	return { events };
};

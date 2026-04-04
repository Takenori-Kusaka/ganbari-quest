import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();

	// sibling-cheer-service.ts の CHEER_STAMPS と一致させる（6種）
	const stamps = [
		{ code: 'ganbare', icon: '💪', label: 'がんばって！' },
		{ code: 'sugoi', icon: '⭐', label: 'すごいね！' },
		{ code: 'issho', icon: '🤝', label: 'いっしょにがんばろう！' },
		{ code: 'omedeto', icon: '🎉', label: 'おめでとう！' },
		{ code: 'nice', icon: '👍', label: 'ナイス！' },
		{ code: 'fight', icon: '🔥', label: 'ファイト！' },
	];

	const children = adminData.children.map((child) => ({
		id: child.id,
		nickname: child.nickname,
		recentMessages: [
			{
				icon: '⭐',
				messageType: 'stamp' as const,
				stampCode: 'sugoi',
				body: null,
				sentAt: '2026-03-27T08:30:00.000Z',
				shownAt: '2026-03-27T09:00:00.000Z',
			},
			{
				icon: '💌',
				messageType: 'text' as const,
				stampCode: null,
				body: 'きょうもがんばったね！',
				sentAt: '2026-03-26T18:00:00.000Z',
				shownAt: '2026-03-26T19:00:00.000Z',
			},
		],
	}));

	return { children, stamps };
};

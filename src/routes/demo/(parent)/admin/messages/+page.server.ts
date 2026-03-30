import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();

	const stamps = [
		{ code: 'great', icon: '👏', label: 'すごい！' },
		{ code: 'love', icon: '❤️', label: 'だいすき' },
		{ code: 'cheer', icon: '📣', label: 'がんばれ！' },
		{ code: 'star', icon: '⭐', label: 'きらきら' },
		{ code: 'muscle', icon: '💪', label: 'つよい！' },
		{ code: 'smile', icon: '😊', label: 'にこにこ' },
		{ code: 'rainbow', icon: '🌈', label: 'すてき！' },
		{ code: 'crown', icon: '👑', label: 'チャンピオン' },
	];

	const children = adminData.children.map((child) => ({
		id: child.id,
		nickname: child.nickname,
		recentMessages: [
			{
				icon: '👏',
				messageType: 'stamp' as const,
				stampCode: 'great',
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

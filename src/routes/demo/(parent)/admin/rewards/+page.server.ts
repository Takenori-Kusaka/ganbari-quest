import { getDemoPointBalance } from '$lib/server/demo/demo-data.js';
import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();
	const children = adminData.children.map((child) => ({
		id: child.id,
		nickname: child.nickname,
		balance: getDemoPointBalance(child.id),
	}));

	const templates = [
		{ title: 'おてつだい', points: 50, icon: '🧹', category: 'せいかつ' },
		{ title: 'テストがんばった', points: 200, icon: '📝', category: 'べんきょう' },
		{ title: 'うんどうかい', points: 300, icon: '🏃', category: 'うんどう' },
		{ title: 'おたんじょうび', points: 500, icon: '🎂', category: 'とくべつ' },
		{ title: 'はっぴょうかい', points: 150, icon: '🎤', category: 'そうぞう' },
		{ title: 'ともだちのおうち', points: 100, icon: '🏠', category: 'こうりゅう' },
	];

	return { children, templates };
};

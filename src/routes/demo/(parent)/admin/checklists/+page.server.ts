import { getDemoAdminData, getDemoChecklistData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();
	const children = adminData.children.map((child) => {
		const checklistData = getDemoChecklistData(child.id);
		return {
			id: child.id,
			nickname: child.nickname,
			checklists: checklistData.checklists,
		};
	});

	return { children };
};

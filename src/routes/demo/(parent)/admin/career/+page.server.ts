import { getDemoAdminData, getDemoCareerData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();
	const children = adminData.children.map((child) => ({
		id: child.id,
		nickname: child.nickname,
		age: child.age,
	}));

	const careerData = getDemoCareerData(904); // teen child

	return {
		children,
		fields: careerData.fields,
		plan: careerData.plan,
	};
};

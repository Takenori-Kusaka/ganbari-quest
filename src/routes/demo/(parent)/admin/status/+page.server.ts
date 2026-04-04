import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { getDemoAdminData, getDemoStatusData } from '$lib/server/demo/demo-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const adminData = getDemoAdminData();

	const childrenWithStatus = adminData.children.map((child) => {
		const status = getDemoStatusData(child.id);
		return {
			id: child.id,
			nickname: child.nickname,
			age: child.age,
			status,
			monthlyComparison: null,
			benchmarkValues: CATEGORY_DEFS.map(() => 50),
		};
	});

	// Demo benchmarks: simple defaults for each age
	const benchmarks = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((age) =>
		CATEGORY_DEFS.map((cat) => ({
			age,
			categoryId: cat.id,
			mean: Math.round(age * 5 + 10),
			stdDev: 10,
		})),
	);

	const levelTitles = Array.from({ length: 10 }, (_, i) => ({
		level: i + 1,
		defaultTitle: `レベル${i + 1}`,
		customTitle: null as string | null,
	}));

	return {
		children: childrenWithStatus,
		categoryDefs: CATEGORY_DEFS,
		benchmarks,
		levelTitles,
	};
};

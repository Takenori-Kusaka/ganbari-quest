// src/routes/ops/cohort/+page.server.ts
// コホート分析ページ (#838)

import { getCohortAnalysis } from '$lib/server/services/cohort-analysis-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const monthsBack = Number.parseInt(url.searchParams.get('months') ?? '6', 10);
	const cohortAnalysis = await getCohortAnalysis(monthsBack);
	return { cohortAnalysis, monthsBack };
};

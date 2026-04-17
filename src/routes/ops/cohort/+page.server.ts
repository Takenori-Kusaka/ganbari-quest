// src/routes/ops/cohort/+page.server.ts
// コホート分析ページ (#838)

import { getCohortAnalysis } from '$lib/server/services/cohort-analysis-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const parsed = Number.parseInt(url.searchParams.get('months') ?? '6', 10);
	const monthsBack = Number.isNaN(parsed) ? 6 : Math.max(1, Math.min(parsed, 24));
	const cohortAnalysis = await getCohortAnalysis(monthsBack);
	return { cohortAnalysis, monthsBack };
};

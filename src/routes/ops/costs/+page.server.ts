// src/routes/ops/costs/+page.server.ts
// AWS費用詳細ページ (#0176 Phase 3)

import { getAWSCostData } from '$lib/server/services/ops-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const now = new Date();
	const year = Number.parseInt(url.searchParams.get('year') ?? String(now.getFullYear()), 10);
	const month = Number.parseInt(url.searchParams.get('month') ?? String(now.getMonth() + 1), 10);

	const costs = await getAWSCostData(year, month);

	// 前月も取得（比較用）
	const prevMonth = month === 1 ? 12 : month - 1;
	const prevYear = month === 1 ? year - 1 : year;
	const prevCosts = await getAWSCostData(prevYear, prevMonth);

	return { costs, prevCosts, year, month };
};

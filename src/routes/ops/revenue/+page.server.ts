// src/routes/ops/revenue/+page.server.ts
// 収益詳細ページ (#0176 Phase 2)

import { getRevenueData } from '$lib/server/services/ops-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// クエリパラメータで期間指定（デフォルト: 過去12ヶ月）
	const now = new Date();
	const monthsBack = Number.parseInt(url.searchParams.get('months') ?? '12', 10);

	const from = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
	const to = now;

	const revenue = await getRevenueData(from, to);

	return { revenue, monthsBack };
};

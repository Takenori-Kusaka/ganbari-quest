// src/routes/ops/costs/+page.server.ts
// AWS費用詳細ページ (#0176 Phase 3)

import { jstYearMonth } from '$lib/domain/date-utils';
import { getAWSCostData } from '$lib/server/services/ops-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// 既定の対象年月は JST SSOT 経由 (#4015)。ローカル getter だと Lambda (UTC) で
	// 月初 / 年始の 00:00〜09:00 に前月 / 前年のコストが既定表示になる。
	const nowJst = jstYearMonth();
	const year = Number.parseInt(url.searchParams.get('year') ?? String(nowJst.year), 10);
	const month = Number.parseInt(url.searchParams.get('month') ?? String(nowJst.month), 10);

	const costs = await getAWSCostData(year, month);

	// 前月も取得（比較用）
	const prevMonth = month === 1 ? 12 : month - 1;
	const prevYear = month === 1 ? year - 1 : year;
	const prevCosts = await getAWSCostData(prevYear, prevMonth);

	return { costs, prevCosts, year, month };
};

// src/routes/ops/revenue/+page.server.ts
// 収益詳細ページ (#0176 Phase 2, #835 Stripe 収益指標追加)

import { monthStartJST, shiftMonthKey } from '$lib/domain/date-utils';
import { getRevenueData } from '$lib/server/services/ops-service';
import { getStripeMetrics } from '$lib/server/services/stripe-metrics-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// クエリパラメータで期間指定（デフォルト: 過去12ヶ月）
	const monthsBack = Number.parseInt(url.searchParams.get('months') ?? '12', 10);

	// 集計開始月は JST SSOT 経由 (#4015)。ローカル getter だと Lambda (UTC) で
	// 月初 00:00〜09:00 に 1 ヶ月ずれた範囲を集計していた。
	const fromMonthKey = shiftMonthKey(monthStartJST().slice(0, 7), -monthsBack);
	const from = new Date(`${fromMonthKey}-01T00:00:00+09:00`);
	const to = new Date();

	const [revenue, metrics] = await Promise.all([getRevenueData(from, to), getStripeMetrics()]);

	return { revenue, metrics, monthsBack };
};

// src/routes/ops/export/+server.ts
// CSVダウンロードAPI (#0176 Phase 4)

import {
	generateExpenseLedgerCsv,
	generatePLSummary,
	generateSalesLedgerCsv,
	getAWSCostData,
	getRevenueData,
} from '$lib/server/services/ops-service';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const type = url.searchParams.get('type');
	const year = Number.parseInt(
		url.searchParams.get('year') ?? String(new Date().getFullYear()),
		10,
	);
	const fromMonth = Number.parseInt(url.searchParams.get('from') ?? '1', 10);
	const toMonth = Number.parseInt(url.searchParams.get('to') ?? '12', 10);

	if (!type || !['sales', 'expenses', 'summary'].includes(type)) {
		error(400, 'Invalid export type');
	}

	const from = new Date(year, fromMonth - 1, 1);
	const to = new Date(year, toMonth, 0, 23, 59, 59); // 月末

	if (type === 'sales') {
		const revenue = await getRevenueData(from, to);
		const csv = generateSalesLedgerCsv(revenue.invoices);
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="sales_${year}_${fromMonth}-${toMonth}.csv"`,
			},
		});
	}

	if (type === 'expenses') {
		// 対象月ごとに費用を取得し結合
		let allCsv = '取引日,勘定科目,摘要,金額(税込),消費税率,金額(税抜),支払先';
		const revenue = await getRevenueData(from, to);

		for (let m = fromMonth; m <= toMonth; m++) {
			const costs = await getAWSCostData(year, m);
			const monthStr = `${year}-${String(m).padStart(2, '0')}`;
			// 月ごとのStripe手数料を概算
			const monthlyFees =
				revenue.monthlyBreakdown.find((mb) => mb.month === monthStr)?.stripeFees ?? 0;
			const csv = generateExpenseLedgerCsv(costs, monthlyFees, monthStr);
			// ヘッダー行を除去して追加
			const lines = csv.split('\n').slice(1);
			if (lines.length > 0) {
				allCsv += `\n${lines.join('\n')}`;
			}
		}

		return new Response(allCsv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="expenses_${year}_${fromMonth}-${toMonth}.csv"`,
			},
		});
	}

	// summary
	const revenue = await getRevenueData(from, to);
	const costs = await getAWSCostData(year, toMonth);
	const summary = generatePLSummary(revenue, costs);

	return new Response(summary, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Content-Disposition': `attachment; filename="pl_summary_${year}_${fromMonth}-${toMonth}.txt"`,
		},
	});
};

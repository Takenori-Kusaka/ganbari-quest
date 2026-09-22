// tests/unit/services/ops-kpi-report.test.ts (#4962)
// 週次運営レポートの「利用状況」節が `/ops` と同じ導出 (getKpiSummary) の値を、同じラベルで出すこと。

import { describe, expect, it } from 'vitest';
import { formatYen } from '../../../src/lib/domain/constants/plan-price';
import {
	ALL_SUBSCRIPTION_PLANS,
	SUBSCRIPTION_PLAN,
	type SubscriptionPlan,
} from '../../../src/lib/domain/constants/subscription-plan';
import { OPS_LABELS } from '../../../src/lib/domain/labels';
import { buildOpsPlanRows, sumOpsPlanMrr } from '../../../src/lib/domain/ops-plan-rows';
import { formatOpsKpiReportText } from '../../../src/lib/server/services/ops-kpi-report';
import type { OpsKpiSummary } from '../../../src/lib/server/services/ops-service';

const COUNTS: Record<SubscriptionPlan, number> = {
	[SUBSCRIPTION_PLAN.MONTHLY]: 2,
	[SUBSCRIPTION_PLAN.YEARLY]: 0,
	[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]: 1,
	[SUBSCRIPTION_PLAN.FAMILY_YEARLY]: 0,
	[SUBSCRIPTION_PLAN.LIFETIME]: 1,
};

function makeSummary(): OpsKpiSummary {
	const planRows = buildOpsPlanRows(COUNTS);
	return {
		tenantStats: {
			total: 7,
			active: 6,
			gracePeriod: 1,
			suspended: 0,
			terminated: 0,
			planRows,
			noPlan: 2,
			unknownPlan: 0,
			totalMrr: sumOpsPlanMrr(planRows),
			newThisMonth: 3,
		},
		activeRate: 6 / 7,
		stripeEnabled: true,
		fetchedAt: '2026-09-21T00:00:00.000Z',
	};
}

describe('formatOpsKpiReportText (#4962)', () => {
	const summary = makeSummary();
	const lines = formatOpsKpiReportText(summary).split('\n');

	it('全プランを 0 件の行も含めて 1 行ずつ出す', () => {
		for (const plan of ALL_SUBSCRIPTION_PLANS) {
			const label = OPS_LABELS.planRowLabels[plan];
			expect(lines.filter((l) => l.startsWith(`${label}: `))).toHaveLength(1);
		}
		expect(lines).toContain(`${OPS_LABELS.planRowLabels.yearly}: 0 / ${formatYen(0)}`);
	});

	it('買い切りの MRR は ¥0 ではなく「対象外」で出す', () => {
		expect(lines).toContain(`${OPS_LABELS.planRowLabels.lifetime}: 1 / ${OPS_LABELS.planMrrNone}`);
	});

	it('合計 MRR は集計値 (totalMrr) をそのまま出し、レポート側で掛け直さない', () => {
		expect(lines).toContain(
			`${OPS_LABELS.planTotalMrr}: ${formatYen(summary.tenantStats.totalMrr)}`,
		);
	});

	it('総数・アクティブ率・プラン未設定・不明なプラン値を出す (0 件でも行を消さない)', () => {
		expect(lines[0]).toBe(`${OPS_LABELS.kpiLabelTotal}: 7 (${OPS_LABELS.kpiNewThisMonth(3)})`);
		expect(lines).toContain(`${OPS_LABELS.kpiLabelActive}: 6 (86%)`);
		expect(lines).toContain(`${OPS_LABELS.planNone}: 2`);
		expect(lines).toContain(`${OPS_LABELS.planUnknown}: 0`);
	});
});

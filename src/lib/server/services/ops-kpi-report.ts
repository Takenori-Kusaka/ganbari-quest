// src/lib/server/services/ops-kpi-report.ts
// 週次運営レポート (weekly-report.yml) の「利用状況」節を組み立てる (#4962)。
//
// 数値は getKpiSummary() (= `/ops` ダッシュボード) の導出だけを使い、ラベルも `/ops` と同じ
// OPS_LABELS を引く。レポート側で数え直したり単価を掛け直したりしない (2 つ目の集計を作らない、#4505)。

import { formatYen } from '$lib/domain/constants/plan-price';
import { OPS_LABELS } from '$lib/domain/labels';
import type { OpsKpiSummary } from './ops-service';

/** Discord の code block にそのまま入れる複数行テキストを返す。プラン行は 0 件でも出す。 */
export function formatOpsKpiReportText(summary: OpsKpiSummary): string {
	const s = summary.tenantStats;
	const activePercent = Math.round(summary.activeRate * 100);
	const lines = [
		`${OPS_LABELS.kpiLabelTotal}: ${s.total} (${OPS_LABELS.kpiNewThisMonth(s.newThisMonth)})`,
		`${OPS_LABELS.kpiLabelActive}: ${s.active} (${activePercent}%)`,
		`${OPS_LABELS.kpiLabelGracePeriod}: ${s.gracePeriod}`,
		`${OPS_LABELS.kpiLabelSuspended}: ${s.suspended}`,
		`${OPS_LABELS.kpiLabelTerminated}: ${s.terminated}`,
		'',
		OPS_LABELS.planBreakdownTitle,
		...s.planRows.map(
			(row) =>
				`${OPS_LABELS.planRowLabels[row.plan]}: ${row.tenants} / ${
					row.mrr === null ? OPS_LABELS.planMrrNone : formatYen(row.mrr)
				}`,
		),
		`${OPS_LABELS.planNone}: ${s.noPlan}`,
		`${OPS_LABELS.planUnknown}: ${s.unknownPlan}`,
		`${OPS_LABELS.planTotalMrr}: ${formatYen(s.totalMrr)}`,
	];
	return lines.join('\n');
}

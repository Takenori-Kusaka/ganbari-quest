<script lang="ts">
import { OPS_REVENUE_LABELS } from '$lib/domain/labels';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const rev = $derived(data.revenue);
const metrics = $derived(data.metrics);
const current = $derived(metrics.current);
const trend = $derived(metrics.trend);

// Chart constants
const chartW = 560;
const chartH = 200;
const padL = 60;
const padR = 20;
const padT = 20;
const padB = 40;
const innerW = chartW - padL - padR;
const innerH = chartH - padT - padB;
const maxMrr = $derived(Math.max(...trend.map((t) => t.mrr), 1));
const chartPoints = $derived(
	trend
		.map((t, i) => {
			const x = padL + (i / Math.max(trend.length - 1, 1)) * innerW;
			const y = padT + innerH * (1 - t.mrr / maxMrr);
			return `${x},${y}`;
		})
		.join(' '),
);
</script>

<svelte:head>
	<title>{OPS_REVENUE_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- モック表示 -->
	{#if current.isMock}
		<div class="text-center">
			<Badge variant="warning" size="md">{OPS_REVENUE_LABELS.mockModeBadge}</Badge>
		</div>
	{/if}

	<!-- Stripe KPI カード (#835) -->
	<h2 class="text-lg font-bold text-[var(--color-text-primary)] m-0">{OPS_REVENUE_LABELS.stripeKpiTitle}</h2>
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">MRR</div>
			<div class="ops-kpi-value">&yen;{current.mrr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">ARR</div>
			<div class="ops-kpi-value">&yen;{current.arr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">ARPU</div>
			<div class="ops-kpi-value">&yen;{current.arpu.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelPaidUsers}</div>
			<div class="ops-kpi-value">{current.activePaidCount}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelConversionRate}</div>
			<div class="ops-kpi-value">{(current.trialToActiveRate * 100).toFixed(1)}%</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelChurnRate}</div>
			<div class="ops-kpi-value {current.monthlyChurnRate > 0.1 ? 'ops-kpi-value--danger' : ''}">{(current.monthlyChurnRate * 100).toFixed(1)}%</div>
		</Card>
	</div>

	<!-- トレンド表 (#835) -->
	{#if trend.length > 0}
		<Card padding="lg">
			<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_REVENUE_LABELS.kpiTrendTitle} {OPS_REVENUE_LABELS.trendTitle}</h2>

			<!-- SVG 折れ線グラフ -->
			<div class="ops-chart-container">
				<svg viewBox="0 0 {chartW} {chartH}" class="ops-chart-svg" role="img" aria-label={OPS_REVENUE_LABELS.trendChartAriaLabel}>
					<!-- Grid lines -->
					{#each [0, 0.25, 0.5, 0.75, 1] as ratio}
						{@const y = padT + innerH * (1 - ratio)}
						<line x1={padL} y1={y} x2={chartW - padR} y2={y} class="ops-chart-grid" />
						<text x={padL - 8} y={y + 4} class="ops-chart-label" text-anchor="end">
							&yen;{Math.round(maxMrr * ratio).toLocaleString()}
						</text>
					{/each}

					<!-- Line -->
					<polyline points={chartPoints} class="ops-chart-line" fill="none" />

					<!-- Dots + labels -->
					{#each trend as t, i}
						{@const x = padL + (i / Math.max(trend.length - 1, 1)) * innerW}
						{@const y = padT + innerH * (1 - t.mrr / maxMrr)}
						<circle cx={x} cy={y} r="4" class="ops-chart-dot" />
						<text x={x} y={chartH - 8} class="ops-chart-xlabel" text-anchor="middle">{t.month.slice(5)}</text>
					{/each}
				</svg>
			</div>

			<!-- テーブル -->
			<table class="ops-table mt-4">
				<thead>
					<tr>
						<th>{OPS_REVENUE_LABELS.tableColMonth}</th>
						<th class="ops-num">MRR</th>
						<th class="ops-num">{OPS_REVENUE_LABELS.tableColPaidCount}</th>
						<th class="ops-num">{OPS_REVENUE_LABELS.tableColChurnRate}</th>
					</tr>
				</thead>
				<tbody>
					{#each trend as t}
						<tr>
							<td>{t.month}</td>
							<td class="ops-num">&yen;{t.mrr.toLocaleString()}</td>
							<td class="ops-num">{t.activePaidCount}</td>
							<td class="ops-num">{(t.churnRate * 100).toFixed(1)}%</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card>
	{/if}

	<!-- 既存: Stripe MRR/ARR (DB ベース) -->
	<h2 class="text-lg font-bold text-[var(--color-text-primary)] m-0">{OPS_REVENUE_LABELS.dbRevenueTitle}</h2>
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelMrrDb}</div>
			<div class="ops-kpi-value">&yen;{rev.mrr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelArrDb}</div>
			<div class="ops-kpi-value">&yen;{rev.arr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelPeriodRevenue}</div>
			<div class="ops-kpi-value">&yen;{rev.totalRevenue.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_REVENUE_LABELS.kpiLabelStripeFeeTotal}</div>
			<div class="ops-kpi-value ops-kpi-value--danger">&yen;{rev.totalStripeFees.toLocaleString()}</div>
		</Card>
	</div>

	<!-- 月次推移 -->
	{#if rev.monthlyBreakdown.length > 0}
		<Card padding="lg">
			<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_REVENUE_LABELS.monthlyBreakdownTitle} {OPS_REVENUE_LABELS.monthlyBreakdownSuffix(data.monthsBack)}</h2>
			<table class="ops-table">
				<thead>
					<tr>
						<th>{OPS_REVENUE_LABELS.tableColMonth}</th>
						<th class="ops-num">{OPS_REVENUE_LABELS.tableColRevenue}</th>
						<th class="ops-num">{OPS_REVENUE_LABELS.tableColCount}</th>
						<th class="ops-num">{OPS_REVENUE_LABELS.tableColFee}</th>
						<th class="ops-num">{OPS_REVENUE_LABELS.tableColNetIncome}</th>
					</tr>
				</thead>
				<tbody>
					{#each rev.monthlyBreakdown as m}
						<tr>
							<td>{m.month}</td>
							<td class="ops-num">&yen;{m.revenue.toLocaleString()}</td>
							<td class="ops-num">{m.invoiceCount}</td>
							<td class="ops-num">&yen;{m.stripeFees.toLocaleString()}</td>
							<td class="ops-num">&yen;{(m.revenue - m.stripeFees).toLocaleString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card>
	{/if}

	<!-- 請求書一覧 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_REVENUE_LABELS.invoicesTitle} ({OPS_REVENUE_LABELS.invoicesTitleSuffix}{rev.invoices.length}{OPS_REVENUE_LABELS.invoicesTitleSuffix2})</h2>
		{#if rev.invoices.length === 0}
			<p class="text-[var(--color-text-muted)] text-sm text-center p-8">{OPS_REVENUE_LABELS.invoicesEmpty}</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="ops-table">
					<thead>
						<tr>
							<th>{OPS_REVENUE_LABELS.tableColPaidAt}</th>
							<th>{OPS_REVENUE_LABELS.tableColCustomer}</th>
							<th>{OPS_REVENUE_LABELS.tableColContent}</th>
							<th class="ops-num">{OPS_REVENUE_LABELS.tableColAmount}</th>
							<th class="ops-num">{OPS_REVENUE_LABELS.tableColFeeLabel}</th>
						</tr>
					</thead>
					<tbody>
						{#each rev.invoices as inv}
							<tr>
								<td>{inv.paidAt ? inv.paidAt.slice(0, 10) : '-'}</td>
								<td class="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">{inv.customerEmail || inv.customerId.slice(0, 12)}</td>
								<td>{inv.planDescription || '-'}</td>
								<td class="ops-num">&yen;{inv.amount.toLocaleString()}</td>
								<td class="ops-num">&yen;{inv.stripeFee.toLocaleString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{OPS_REVENUE_LABELS.fetchedAt(current.fetchedAt ? new Date(current.fetchedAt).toLocaleString('ja-JP') : '-')}
		{OPS_REVENUE_LABELS.cacheNote}
	</div>
</div>

<style>
	.ops-kpi-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.ops-kpi-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.ops-kpi-value--danger {
		color: var(--color-action-danger);
	}

	.ops-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.ops-table th,
	.ops-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border-light);
	}

	.ops-table th {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.ops-num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	/* SVG Chart */
	.ops-chart-container {
		width: 100%;
		max-width: 600px;
		margin: 0 auto;
	}

	.ops-chart-svg {
		width: 100%;
		height: auto;
	}

	.ops-chart-grid {
		stroke: var(--color-border-light);
		stroke-width: 1;
	}

	.ops-chart-label {
		font-size: 10px;
		fill: var(--color-text-muted);
	}

	.ops-chart-line {
		stroke: var(--color-action-primary);
		stroke-width: 2.5;
		stroke-linejoin: round;
	}

	.ops-chart-dot {
		fill: var(--color-action-primary);
	}

	.ops-chart-xlabel {
		font-size: 10px;
		fill: var(--color-text-muted);
	}
</style>

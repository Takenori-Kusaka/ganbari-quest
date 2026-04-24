<script lang="ts">
import { OPS_BUSINESS_LABELS } from '$lib/domain/labels';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Progress from '$lib/ui/primitives/Progress.svelte';

let { data } = $props();
const bep = $derived(data.breakeven);
const isProfit = $derived(bep.monthlyProfit >= 0);
const progressPct = $derived(Math.min(bep.progressRate * 100, 100));
const progressColor = $derived(
	bep.progressRate >= 1
		? 'var(--color-action-success)'
		: bep.progressRate >= 0.5
			? 'var(--color-action-primary)'
			: 'var(--color-action-danger)',
);
</script>

<svelte:head>
	<title>{OPS_BUSINESS_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- モック表示 -->
	{#if bep.isMock}
		<div class="text-center">
			<Badge variant="warning" size="md">{OPS_BUSINESS_LABELS.mockModeBadge}</Badge>
		</div>
	{/if}

	<!-- 損益分岐点 進捗バー -->
	<Card padding="lg">
		<h2 class="text-lg font-bold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_BUSINESS_LABELS.breakevenProgressTitle}</h2>
		<div class="flex flex-col gap-3">
			<div class="flex justify-between items-end">
				<div>
					<span class="text-3xl font-bold text-[var(--color-text)]">{bep.currentPaidUsers}</span>
					<span class="text-[var(--color-text-muted)] text-sm"> / {bep.breakevenUsers} {OPS_BUSINESS_LABELS.breakevenUsersUnitSuffix}</span>
				</div>
				<div class="text-right">
					{#if bep.progressRate >= 1}
						<Badge variant="success" size="md">{OPS_BUSINESS_LABELS.breakevenAchievedBadge}</Badge>
					{:else}
						<span class="text-sm text-[var(--color-text-muted)]">{OPS_BUSINESS_LABELS.breakevenRemainingUsers(Math.max(0, bep.breakevenUsers - bep.currentPaidUsers))}</span>
					{/if}
				</div>
			</div>
			<Progress
				value={progressPct}
				max={100}
				label={OPS_BUSINESS_LABELS.breakevenProgressLabel}
				color={progressColor}
				size="lg"
			/>
		</div>
	</Card>

	<!-- 収支カード -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelRevenue}</div>
			<div class="ops-kpi-value">&yen;{bep.monthlyRevenue.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelAwsCost}</div>
			<div class="ops-kpi-value">&yen;{bep.awsCostJpy.toLocaleString()}</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">{OPS_BUSINESS_LABELS.kpiAwsCostUsdSuffix(`${bep.awsCostUsd.toFixed(2)}`)}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelStripeFee}</div>
			<div class="ops-kpi-value">&yen;{bep.stripeFee.toLocaleString()}</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">{OPS_BUSINESS_LABELS.kpiStripeFeeNote}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelFixedCosts}</div>
			<div class="ops-kpi-value">&yen;{bep.fixedCosts.toLocaleString()}</div>
			{#if bep.fixedCostBreakdown.length > 0}
				<div class="text-xs text-[var(--color-text-muted)] mt-1">
					{bep.fixedCostBreakdown.map((c) => c.label).join(' + ')}
				</div>
			{/if}
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelMonthlyProfit}</div>
			<div class="ops-kpi-value {isProfit ? '' : 'ops-kpi-value--danger'}">
				&yen;{bep.monthlyProfit.toLocaleString()}
			</div>
			{#if !isProfit}
				<div class="text-xs mt-1 text-[var(--color-feedback-error-text)]">{OPS_BUSINESS_LABELS.kpiProfitLoss}</div>
			{/if}
		</Card>
	</div>

	<!-- 赤字警告 -->
	{#if !isProfit}
		<Card padding="lg" class="bep-warning-card">
			<div class="flex items-center gap-3">
				<span class="text-2xl">&#x26A0;</span>
				<div>
					<div class="font-bold text-[var(--color-feedback-error-text)]">{OPS_BUSINESS_LABELS.warningTitle}</div>
					<div class="text-sm text-[var(--color-feedback-error-text)]">
						{OPS_BUSINESS_LABELS.warningDesc(Math.max(0, bep.breakevenUsers - bep.currentPaidUsers))}
					</div>
				</div>
			</div>
		</Card>
	{/if}

	<!-- 損益内訳テーブル -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_BUSINESS_LABELS.breakdownTitle}</h2>
		<table class="ops-table">
			<thead>
				<tr>
					<th>{OPS_BUSINESS_LABELS.tableColItem}</th>
					<th class="ops-num">{OPS_BUSINESS_LABELS.tableColAmount}</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>{OPS_BUSINESS_LABELS.tableRowRevenue}</td>
					<td class="ops-num">&yen;{bep.monthlyRevenue.toLocaleString()}</td>
				</tr>
				<tr class="ops-expense">
					<td>{OPS_BUSINESS_LABELS.tableRowAwsCost}</td>
					<td class="ops-num">-&yen;{bep.awsCostJpy.toLocaleString()}</td>
				</tr>
				<tr class="ops-expense">
					<td>{OPS_BUSINESS_LABELS.tableRowStripeFee}</td>
					<td class="ops-num">-&yen;{bep.stripeFee.toLocaleString()}</td>
				</tr>
				{#each bep.fixedCostBreakdown as cost}
					<tr class="ops-expense">
						<td>- {cost.label}</td>
						<td class="ops-num">-&yen;{cost.amount.toLocaleString()}</td>
					</tr>
				{/each}
				<tr class="total-row">
					<td>{OPS_BUSINESS_LABELS.tableRowMonthlyProfit}</td>
					<td class="ops-num {isProfit ? '' : 'ops-text-danger'}">&yen;{bep.monthlyProfit.toLocaleString()}</td>
				</tr>
			</tbody>
		</table>
	</Card>

	<!-- 規模帯比較 (19-プライシング戦略書 §6.3) -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_BUSINESS_LABELS.scaleTiersTitle}</h2>
		<div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
			{#each bep.scaleTiers as tier}
				{@const isCurrentTier = tier.id === bep.currentScaleTier.id}
				<div class="bep-scale-card {isCurrentTier ? 'bep-scale-card--active' : ''}">
					<div class="flex items-center justify-between mb-1">
						<span class="text-sm font-bold">{tier.label}</span>
						{#if isCurrentTier}
							<Badge variant="accent" size="sm">{OPS_BUSINESS_LABELS.scaleTiersCurrentBadge}</Badge>
						{/if}
					</div>
					<div class="text-xs text-[var(--color-text-muted)]">
						{tier.minUsers}{tier.maxUsers ? `-${tier.maxUsers}` : '+'} {OPS_BUSINESS_LABELS.breakevenUsersUnitSuffix}
					</div>
					<div class="text-sm font-semibold mt-1">
						¥{tier.monthlyRevenueEstimate.toLocaleString()}{OPS_BUSINESS_LABELS.scaleTiersMonthlyRevenueSuffix}
					</div>
				</div>
			{/each}
		</div>
	</Card>

	<!-- KPI サマリー -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_BUSINESS_LABELS.kpiSummaryTitle}</h2>
		<div class="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
			<div class="text-center">
				<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelMrr}</div>
				<div class="text-lg font-bold text-[var(--color-text)]">&yen;{bep.metrics.mrr.toLocaleString()}</div>
			</div>
			<div class="text-center">
				<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelArr}</div>
				<div class="text-lg font-bold text-[var(--color-text)]">&yen;{bep.metrics.arr.toLocaleString()}</div>
			</div>
			<div class="text-center">
				<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelArpu}</div>
				<div class="text-lg font-bold text-[var(--color-text)]">&yen;{bep.metrics.arpu.toLocaleString()}</div>
			</div>
			<div class="text-center">
				<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelConversionRate}</div>
				<div class="text-lg font-bold text-[var(--color-text)]">{(bep.metrics.trialToActiveRate * 100).toFixed(1)}%</div>
			</div>
			<div class="text-center">
				<div class="ops-kpi-label">{OPS_BUSINESS_LABELS.kpiLabelChurnRate}</div>
				<div class="text-lg font-bold text-[var(--color-text)]">{(bep.metrics.monthlyChurnRate * 100).toFixed(1)}%</div>
			</div>
		</div>
	</Card>

	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{OPS_BUSINESS_LABELS.fetchedAt(bep.fetchedAt ? new Date(bep.fetchedAt).toLocaleString('ja-JP') : '-')}
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
		color: var(--color-feedback-error-text);
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

	.ops-expense td {
		color: var(--color-text-secondary);
	}

	.ops-text-danger {
		color: var(--color-feedback-error-text);
	}

	.total-row td {
		font-weight: 700;
		border-top: 2px solid var(--color-border-default);
	}

	:global(.bep-warning-card) {
		background-color: var(--color-surface-error);
		border-color: var(--color-feedback-error-border);
	}

	.bep-scale-card {
		padding: 0.75rem;
		border-radius: var(--card-radius);
		border: 1px solid var(--color-border-default);
		background: var(--color-surface-card);
	}

	.bep-scale-card--active {
		border-color: var(--color-action-primary);
		background: var(--color-surface-accent);
	}
</style>

<script lang="ts">
import { OPS_COSTS_LABELS } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const costs = $derived(data.costs);
const prevCosts = $derived(data.prevCosts);
const usdToJpy = 150; // USD→JPY概算レート
const prevM = $derived(data.month === 1 ? 12 : data.month - 1);
const prevY = $derived(data.month === 1 ? data.year - 1 : data.year);
const nextM = $derived(data.month === 12 ? 1 : data.month + 1);
const nextY = $derived(data.month === 12 ? data.year + 1 : data.year);
const costDiff = $derived(costs.total - prevCosts.total);
const diffColorClass = $derived(
	costDiff < 0
		? 'text-[var(--color-success)]'
		: costDiff > 0
			? 'text-[var(--color-danger)]'
			: 'text-[var(--color-text)]',
);
</script>

<svelte:head>
	<title>{OPS_COSTS_LABELS.pageTitle}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- 期間選択 -->
	<div class="flex justify-center items-center gap-8">
		<a href="/ops/costs?year={prevY}&month={prevM}" class="text-[var(--color-brand-600)] no-underline text-sm hover:underline">{OPS_COSTS_LABELS.prevMonthLink}</a>
		<span class="text-xl font-bold">{OPS_COSTS_LABELS.yearMonthDisplay(data.year, data.month)}</span>
		<a href="/ops/costs?year={nextY}&month={nextM}" class="text-[var(--color-brand-600)] no-underline text-sm hover:underline">{OPS_COSTS_LABELS.nextMonthLink}</a>
	</div>

	<!-- 費用サマリー -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_COSTS_LABELS.currentCostLabel}</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-text)]">${costs.total.toFixed(2)}</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">≒ ¥{Math.round(costs.total * usdToJpy).toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_COSTS_LABELS.prevMonthDiffLabel}</div>
			<div class="text-[1.75rem] font-bold {diffColorClass}">
				{costDiff >= 0 ? '+' : ''}{costDiff.toFixed(2)}
			</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">
				{prevCosts.total > 0 ? `${((costDiff / prevCosts.total) * 100).toFixed(1)}%` : '-'}
			</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_COSTS_LABELS.serviceCountLabel}</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-text)]">{costs.services.length}</div>
		</Card>
	</div>

	<!-- サービス別内訳 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_COSTS_LABELS.serviceBreakdownTitle}</h2>
		{#if costs.services.length === 0}
			<p class="text-[var(--color-text-muted)] text-sm text-center p-8">{OPS_COSTS_LABELS.noCostData}</p>
		{:else}
			<table class="ops-table">
				<thead>
					<tr>
						<th>{OPS_COSTS_LABELS.colService}</th>
						<th class="ops-num">{OPS_COSTS_LABELS.colCostUsd}</th>
						<th class="ops-num">{OPS_COSTS_LABELS.colCostJpy}</th>
						<th class="ops-num">{OPS_COSTS_LABELS.colRatio}</th>
					</tr>
				</thead>
				<tbody>
					{#each costs.services as svc}
						<tr>
							<td>{svc.service}</td>
							<td class="ops-num">${svc.amount.toFixed(4)}</td>
							<td class="ops-num">¥{Math.round(svc.amount * usdToJpy).toLocaleString()}</td>
							<td class="ops-num">{costs.total > 0 ? ((svc.amount / costs.total) * 100).toFixed(1) : 0}%</td>
						</tr>
					{/each}
					<tr class="total-row">
						<td>{OPS_COSTS_LABELS.totalRow}</td>
						<td class="ops-num">${costs.total.toFixed(4)}</td>
						<td class="ops-num">¥{Math.round(costs.total * usdToJpy).toLocaleString()}</td>
						<td class="ops-num">100%</td>
					</tr>
				</tbody>
			</table>
		{/if}
	</Card>

	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{OPS_COSTS_LABELS.lastFetchedPrefix}{costs.fetchedAt ? new Date(costs.fetchedAt).toLocaleString('ja-JP') : '-'}
		{OPS_COSTS_LABELS.cacheNote}
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

	.total-row td {
		font-weight: 700;
		border-top: 2px solid var(--color-border-default);
	}
</style>

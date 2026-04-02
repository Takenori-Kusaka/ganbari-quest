<script lang="ts">
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
			: 'text-[var(--color-neutral-900)]',
);
</script>

<svelte:head>
	<title>OPS - AWS費用</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- 期間選択 -->
	<div class="flex justify-center items-center gap-8">
		<a href="/ops/costs?year={prevY}&month={prevM}" class="text-[var(--color-brand-600)] no-underline text-sm hover:underline">← 前月</a>
		<span class="text-xl font-bold">{data.year}年{data.month}月</span>
		<a href="/ops/costs?year={nextY}&month={nextM}" class="text-[var(--color-brand-600)] no-underline text-sm hover:underline">翌月 →</a>
	</div>

	<!-- 費用サマリー -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<div class="bg-[var(--color-surface-card)] border border-[var(--color-border-default)] rounded-xl p-5 text-center">
			<div class="ops-kpi-label">当月 AWS 費用</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-neutral-900)]">${costs.total.toFixed(2)}</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">≒ ¥{Math.round(costs.total * usdToJpy).toLocaleString()}</div>
		</div>
		<div class="bg-[var(--color-surface-card)] border border-[var(--color-border-default)] rounded-xl p-5 text-center">
			<div class="ops-kpi-label">前月比</div>
			<div class="text-[1.75rem] font-bold {diffColorClass}">
				{costDiff >= 0 ? '+' : ''}{costDiff.toFixed(2)}
			</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">
				{prevCosts.total > 0 ? `${((costDiff / prevCosts.total) * 100).toFixed(1)}%` : '-'}
			</div>
		</div>
		<div class="bg-[var(--color-surface-card)] border border-[var(--color-border-default)] rounded-xl p-5 text-center">
			<div class="ops-kpi-label">サービス数</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-neutral-900)]">{costs.services.length}</div>
		</div>
	</div>

	<!-- サービス別内訳 -->
	<section class="bg-[var(--color-surface-card)] border border-[var(--color-border-default)] rounded-xl p-6">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">サービス別費用内訳</h2>
		{#if costs.services.length === 0}
			<p class="text-[var(--color-neutral-400)] text-sm text-center p-8">費用データがありません（AWS Cost Explorer API が利用不可、またはデータなし）</p>
		{:else}
			<table class="ops-table">
				<thead>
					<tr>
						<th>サービス</th>
						<th class="ops-num">費用 (USD)</th>
						<th class="ops-num">概算 (JPY)</th>
						<th class="ops-num">割合</th>
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
						<td>合計</td>
						<td class="ops-num">${costs.total.toFixed(4)}</td>
						<td class="ops-num">¥{Math.round(costs.total * usdToJpy).toLocaleString()}</td>
						<td class="ops-num">100%</td>
					</tr>
				</tbody>
			</table>
		{/if}
	</section>

	<div class="text-xs text-[var(--color-neutral-400)] text-right">
		最終取得: {costs.fetchedAt ? new Date(costs.fetchedAt).toLocaleString('ja-JP') : '-'}
		（24時間キャッシュ、API費用: $0.01/リクエスト）
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
		border-bottom: 1px solid var(--color-neutral-100);
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

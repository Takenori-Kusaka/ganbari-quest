<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const rev = $derived(data.revenue);
</script>

<svelte:head>
	<title>OPS - 収益</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- KPI カード -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">MRR</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-neutral-900)]">¥{rev.mrr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">ARR</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-neutral-900)]">¥{rev.arr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">期間売上合計</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-neutral-900)]">¥{rev.totalRevenue.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">Stripe手数料合計</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-danger)]">¥{rev.totalStripeFees.toLocaleString()}</div>
		</Card>
	</div>

	<!-- 月次推移 -->
	{#if rev.monthlyBreakdown.length > 0}
		<Card padding="lg">
			<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">月次推移（過去{data.monthsBack}ヶ月）</h2>
			<table class="ops-table">
				<thead>
					<tr>
						<th>月</th>
						<th class="ops-num">売上</th>
						<th class="ops-num">件数</th>
						<th class="ops-num">手数料</th>
						<th class="ops-num">純収入</th>
					</tr>
				</thead>
				<tbody>
					{#each rev.monthlyBreakdown as m}
						<tr>
							<td>{m.month}</td>
							<td class="ops-num">¥{m.revenue.toLocaleString()}</td>
							<td class="ops-num">{m.invoiceCount}</td>
							<td class="ops-num">¥{m.stripeFees.toLocaleString()}</td>
							<td class="ops-num">¥{(m.revenue - m.stripeFees).toLocaleString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card>
	{/if}

	<!-- 請求書一覧 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">Stripe 請求書一覧（直近{rev.invoices.length}件）</h2>
		{#if rev.invoices.length === 0}
			<p class="text-[var(--color-neutral-400)] text-sm text-center p-8">請求書データがありません（Stripe未設定 or 期間内に決済なし）</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="ops-table">
					<thead>
						<tr>
							<th>支払日</th>
							<th>顧客</th>
							<th>内容</th>
							<th class="ops-num">金額</th>
							<th class="ops-num">手数料</th>
						</tr>
					</thead>
					<tbody>
						{#each rev.invoices as inv}
							<tr>
								<td>{inv.paidAt ? inv.paidAt.slice(0, 10) : '-'}</td>
								<td class="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">{inv.customerEmail || inv.customerId.slice(0, 12)}</td>
								<td>{inv.planDescription || '-'}</td>
								<td class="ops-num">¥{inv.amount.toLocaleString()}</td>
								<td class="ops-num">¥{inv.stripeFee.toLocaleString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
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
</style>

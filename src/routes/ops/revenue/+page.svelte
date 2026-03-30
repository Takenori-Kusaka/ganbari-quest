<script lang="ts">
let { data } = $props();
const rev = $derived(data.revenue);
</script>

<svelte:head>
	<title>OPS - 収益</title>
</svelte:head>

<div class="revenue-page">
	<!-- KPI カード -->
	<div class="kpi-cards">
		<div class="kpi-card">
			<div class="kpi-label">MRR</div>
			<div class="kpi-value">¥{rev.mrr.toLocaleString()}</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">ARR</div>
			<div class="kpi-value">¥{rev.arr.toLocaleString()}</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">期間売上合計</div>
			<div class="kpi-value">¥{rev.totalRevenue.toLocaleString()}</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">Stripe手数料合計</div>
			<div class="kpi-value negative">¥{rev.totalStripeFees.toLocaleString()}</div>
		</div>
	</div>

	<!-- 月次推移 -->
	{#if rev.monthlyBreakdown.length > 0}
		<section class="section">
			<h2>月次推移（過去{data.monthsBack}ヶ月）</h2>
			<table class="data-table">
				<thead>
					<tr>
						<th>月</th>
						<th class="num">売上</th>
						<th class="num">件数</th>
						<th class="num">手数料</th>
						<th class="num">純収入</th>
					</tr>
				</thead>
				<tbody>
					{#each rev.monthlyBreakdown as m}
						<tr>
							<td>{m.month}</td>
							<td class="num">¥{m.revenue.toLocaleString()}</td>
							<td class="num">{m.invoiceCount}</td>
							<td class="num">¥{m.stripeFees.toLocaleString()}</td>
							<td class="num">¥{(m.revenue - m.stripeFees).toLocaleString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	<!-- 請求書一覧 -->
	<section class="section">
		<h2>Stripe 請求書一覧（直近{rev.invoices.length}件）</h2>
		{#if rev.invoices.length === 0}
			<p class="empty">請求書データがありません（Stripe未設定 or 期間内に決済なし）</p>
		{:else}
			<div class="table-scroll">
				<table class="data-table">
					<thead>
						<tr>
							<th>支払日</th>
							<th>顧客</th>
							<th>内容</th>
							<th class="num">金額</th>
							<th class="num">手数料</th>
						</tr>
					</thead>
					<tbody>
						{#each rev.invoices as inv}
							<tr>
								<td>{inv.paidAt ? inv.paidAt.slice(0, 10) : '-'}</td>
								<td class="email">{inv.customerEmail || inv.customerId.slice(0, 12)}</td>
								<td>{inv.planDescription || '-'}</td>
								<td class="num">¥{inv.amount.toLocaleString()}</td>
								<td class="num">¥{inv.stripeFee.toLocaleString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.revenue-page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.kpi-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 1rem;
	}

	.kpi-card {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 1.25rem;
		text-align: center;
	}

	.kpi-label {
		font-size: 0.75rem;
		color: #718096;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.kpi-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1a202c;
	}

	.kpi-value.negative {
		color: #e53e3e;
	}

	.section {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 1.5rem;
	}

	.section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: #2d3748;
	}

	.table-scroll {
		overflow-x: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.data-table th,
	.data-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid #edf2f7;
	}

	.data-table th {
		font-size: 0.75rem;
		color: #718096;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.data-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.email {
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		color: #a0aec0;
		font-size: 0.875rem;
		text-align: center;
		padding: 2rem;
	}
</style>

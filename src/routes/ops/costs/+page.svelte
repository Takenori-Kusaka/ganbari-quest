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
</script>

<svelte:head>
	<title>OPS - AWS費用</title>
</svelte:head>

<div class="costs-page">
	<!-- 期間選択 -->
	<div class="period-nav">
		<a href="/ops/costs?year={prevY}&month={prevM}">← 前月</a>
		<span class="period-label">{data.year}年{data.month}月</span>
		<a href="/ops/costs?year={nextY}&month={nextM}">翌月 →</a>
	</div>

	<!-- 費用サマリー -->
	<div class="kpi-cards">
		<div class="kpi-card">
			<div class="kpi-label">当月 AWS 費用</div>
			<div class="kpi-value">${costs.total.toFixed(2)}</div>
			<div class="kpi-sub">≒ ¥{Math.round(costs.total * usdToJpy).toLocaleString()}</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">前月比</div>
				<div class="kpi-value" class:positive={costDiff < 0} class:negative={costDiff > 0}>
				{costDiff >= 0 ? '+' : ''}{costDiff.toFixed(2)}
			</div>
			<div class="kpi-sub">
				{prevCosts.total > 0 ? `${((costDiff / prevCosts.total) * 100).toFixed(1)}%` : '-'}
			</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">サービス数</div>
			<div class="kpi-value">{costs.services.length}</div>
		</div>
	</div>

	<!-- サービス別内訳 -->
	<section class="section">
		<h2>サービス別費用内訳</h2>
		{#if costs.services.length === 0}
			<p class="empty">費用データがありません（AWS Cost Explorer API が利用不可、またはデータなし）</p>
		{:else}
			<table class="data-table">
				<thead>
					<tr>
						<th>サービス</th>
						<th class="num">費用 (USD)</th>
						<th class="num">概算 (JPY)</th>
						<th class="num">割合</th>
					</tr>
				</thead>
				<tbody>
					{#each costs.services as svc}
						<tr>
							<td>{svc.service}</td>
							<td class="num">${svc.amount.toFixed(4)}</td>
							<td class="num">¥{Math.round(svc.amount * usdToJpy).toLocaleString()}</td>
							<td class="num">{costs.total > 0 ? ((svc.amount / costs.total) * 100).toFixed(1) : 0}%</td>
						</tr>
					{/each}
					<tr class="total-row">
						<td>合計</td>
						<td class="num">${costs.total.toFixed(4)}</td>
						<td class="num">¥{Math.round(costs.total * usdToJpy).toLocaleString()}</td>
						<td class="num">100%</td>
					</tr>
				</tbody>
			</table>
		{/if}
	</section>

	<div class="timestamp">
		最終取得: {costs.fetchedAt ? new Date(costs.fetchedAt).toLocaleString('ja-JP') : '-'}
		（24時間キャッシュ、API費用: $0.01/リクエスト）
	</div>
</div>

<style>
	.costs-page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.period-nav {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 2rem;
	}

	.period-nav a {
		color: #4299e1;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.period-nav a:hover {
		text-decoration: underline;
	}

	.period-label {
		font-size: 1.25rem;
		font-weight: 700;
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

	.kpi-value.positive {
		color: #38a169;
	}

	.kpi-value.negative {
		color: #e53e3e;
	}

	.kpi-sub {
		font-size: 0.75rem;
		color: #718096;
		margin-top: 0.25rem;
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

	.total-row td {
		font-weight: 700;
		border-top: 2px solid #e2e8f0;
	}

	.empty {
		color: #a0aec0;
		font-size: 0.875rem;
		text-align: center;
		padding: 2rem;
	}

	.timestamp {
		font-size: 0.75rem;
		color: #a0aec0;
		text-align: right;
	}
</style>

<script lang="ts">
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
	<title>OPS - 収益</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- モック表示 -->
	{#if current.isMock}
		<div class="text-center">
			<Badge variant="warning" size="md">MOCK MODE: ダミーデータを表示中 (STRIPE_MOCK=true)</Badge>
		</div>
	{/if}

	<!-- Stripe KPI カード (#835) -->
	<h2 class="text-lg font-bold text-[var(--color-text-primary)] m-0">Stripe 収益指標</h2>
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
			<div class="ops-kpi-label">有料ユーザー数</div>
			<div class="ops-kpi-value">{current.activePaidCount}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">転換率 (90日)</div>
			<div class="ops-kpi-value">{(current.trialToActiveRate * 100).toFixed(1)}%</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">月次解約率</div>
			<div class="ops-kpi-value {current.monthlyChurnRate > 0.1 ? 'ops-kpi-value--danger' : ''}">{(current.monthlyChurnRate * 100).toFixed(1)}%</div>
		</Card>
	</div>

	<!-- トレンド表 (#835) -->
	{#if trend.length > 0}
		<Card padding="lg">
			<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">KPI トレンド (過去6か月)</h2>

			<!-- SVG 折れ線グラフ -->
			<div class="ops-chart-container">
				<svg viewBox="0 0 {chartW} {chartH}" class="ops-chart-svg" role="img" aria-label="MRR トレンドグラフ">
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
						<th>月</th>
						<th class="ops-num">MRR</th>
						<th class="ops-num">有料数</th>
						<th class="ops-num">解約率</th>
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
	<h2 class="text-lg font-bold text-[var(--color-text-primary)] m-0">Stripe 請求書ベース収益</h2>
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">MRR (DB)</div>
			<div class="ops-kpi-value">&yen;{rev.mrr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">ARR (DB)</div>
			<div class="ops-kpi-value">&yen;{rev.arr.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">期間売上合計</div>
			<div class="ops-kpi-value">&yen;{rev.totalRevenue.toLocaleString()}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">Stripe手数料合計</div>
			<div class="ops-kpi-value ops-kpi-value--danger">&yen;{rev.totalStripeFees.toLocaleString()}</div>
		</Card>
	</div>

	<!-- 月次推移 -->
	{#if rev.monthlyBreakdown.length > 0}
		<Card padding="lg">
			<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">月次推移 (過去{data.monthsBack}か月)</h2>
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
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">Stripe 請求書一覧 (直近{rev.invoices.length}件)</h2>
		{#if rev.invoices.length === 0}
			<p class="text-[var(--color-text-muted)] text-sm text-center p-8">請求書データがありません (Stripe未設定 or 期間内に決済なし)</p>
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
		最終取得: {current.fetchedAt ? new Date(current.fetchedAt).toLocaleString('ja-JP') : '-'}
		(1時間キャッシュ)
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
		color: var(--color-neutral-900);
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

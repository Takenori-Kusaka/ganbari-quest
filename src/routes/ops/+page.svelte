<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const kpi = $derived(data.kpi);
const stats = $derived(kpi.tenantStats);
const activeRate = $derived((kpi.activeRate * 100).toFixed(1));
</script>

<svelte:head>
	<title>OPS - KPI サマリー</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{new Date(kpi.fetchedAt).toLocaleString('ja-JP')} 時点
	</div>

	<!-- KPI カード -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">総テナント数</div>
			<div class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{stats.total}</div>
			<div class="text-xs text-[var(--color-success)] mt-1">+{stats.newThisMonth} 今月</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">アクティブ</div>
			<div class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{stats.active}</div>
			<div class="text-xs text-[var(--color-success)] mt-1">{activeRate}%</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">猶予期間</div>
			<div class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{stats.gracePeriod}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">停止中</div>
			<div class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{stats.suspended}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">退会済み</div>
			<div class="text-[2rem] font-bold text-[var(--color-neutral-900)]">{stats.terminated}</div>
		</Card>
	</div>

	<!-- プラン内訳 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">プラン別内訳（アクティブテナント）</h2>
		<table class="ops-table">
			<thead>
				<tr>
					<th>プラン</th>
					<th>テナント数</th>
					<th>MRR 概算</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>月額 (¥500/月)</td>
					<td>{stats.planBreakdown.monthly}</td>
					<td>¥{(stats.planBreakdown.monthly * 500).toLocaleString()}</td>
				</tr>
				<tr>
					<td>年額 (¥5,000/年)</td>
					<td>{stats.planBreakdown.yearly}</td>
					<td>¥{Math.round(stats.planBreakdown.yearly * 5000 / 12).toLocaleString()}</td>
				</tr>
				<tr>
					<td>ライフタイム</td>
					<td>{stats.planBreakdown.lifetime}</td>
					<td>-</td>
				</tr>
				<tr>
					<td>未設定（トライアル等）</td>
					<td>{stats.planBreakdown.noPlan}</td>
					<td>-</td>
				</tr>
				<tr class="total-row">
					<td>合計 MRR</td>
					<td>{stats.active}</td>
					<td>¥{(stats.planBreakdown.monthly * 500 + Math.round(stats.planBreakdown.yearly * 5000 / 12)).toLocaleString()}</td>
				</tr>
			</tbody>
		</table>
	</Card>

	<!-- ステータス -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">システム状態</h2>
		<div class="flex flex-col gap-2">
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-neutral-600)]">Stripe 連携:</span>
				<span class={kpi.stripeEnabled ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-warning)]'}>
					{kpi.stripeEnabled ? '有効' : '無効（ローカルモード）'}
				</span>
			</div>
		</div>
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
	}

	.ops-table th,
	.ops-table td {
		padding: 0.5rem 1rem;
		text-align: left;
		border-bottom: 1px solid var(--color-neutral-100);
	}

	.ops-table th {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.total-row td {
		font-weight: 700;
		border-top: 2px solid var(--color-border-default);
	}
</style>

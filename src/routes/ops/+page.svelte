<script lang="ts">
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const kpi = $derived(data.kpi);
const stats = $derived(kpi.tenantStats);
const activeRate = $derived((kpi.activeRate * 100).toFixed(1));
const triggerReport = $derived(data.triggerReport);
const firedTriggers = $derived(triggerReport.firedTriggers);
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
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.total}</div>
			<div class="text-xs text-[var(--color-success)] mt-1">+{stats.newThisMonth} 今月</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">アクティブ</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.active}</div>
			<div class="text-xs text-[var(--color-success)] mt-1">{activeRate}%</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">猶予期間</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.gracePeriod}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">停止中</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.suspended}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">退会済み</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.terminated}</div>
		</Card>
	</div>

	<!-- プラン内訳 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">プラン別内訳（アクティブテナント）</h2>
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

	<!-- 価格見直しトリガー (#837) -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">
			価格見直しトリガー
			{#if firedTriggers.length > 0}
				<Badge variant="warning" size="sm">{firedTriggers.length}件発動中</Badge>
			{:else if triggerReport.skipped}
				<Badge variant="neutral" size="sm">スキップ</Badge>
			{:else}
				<Badge variant="success" size="sm">正常</Badge>
			{/if}
		</h2>
		{#if triggerReport.skipped}
			<p class="text-sm text-[var(--color-text-muted)]">
				{triggerReport.skipReason}
			</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each triggerReport.triggers as trigger}
					<div class="flex items-start gap-3 p-3 rounded-lg {trigger.fired ? 'bg-[var(--color-surface-warning)]' : 'bg-[var(--color-surface-muted)]'}">
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<span class="font-medium text-sm">{trigger.description}</span>
								{#if trigger.fired}
									<Badge variant="warning" size="sm">発動</Badge>
								{:else}
									<Badge variant="success" size="sm">正常</Badge>
								{/if}
							</div>
							<div class="text-xs text-[var(--color-text-muted)]">
								現在値: {(trigger.value * 100).toFixed(1)}% / 閾値: {(trigger.threshold * 100).toFixed(1)}%
								({trigger.consecutiveMonths}/{trigger.requiredMonths}ヶ月)
							</div>
							{#if trigger.fired}
								<div class="text-xs text-[var(--color-feedback-warning-text)] mt-1">
									推奨: {trigger.recommendation}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
		<div class="text-xs text-[var(--color-text-muted)] mt-3">
			評価日時: {new Date(triggerReport.evaluatedAt).toLocaleString('ja-JP')}
			| 有料ユーザー: {triggerReport.paidUserCount}人
		</div>
	</Card>

	<!-- ステータス -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">システム状態</h2>
		<div class="flex flex-col gap-2">
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-text-secondary)]">Stripe 連携:</span>
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
		border-bottom: 1px solid var(--color-border-light);
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

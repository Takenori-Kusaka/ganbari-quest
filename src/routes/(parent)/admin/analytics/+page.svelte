<script lang="ts">
import Alert from '$lib/ui/primitives/Alert.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import type { AnalyticsData } from './+page.server';

let { data } = $props();
const analytics: AnalyticsData = $derived(data.analytics);

// 年齢モード別イベント: uiMode を含むイベントをフィルタ
const uiModeEvents = $derived(
	analytics.events.filter(
		(e: { x: string; y: number }) =>
			e.x.includes('baby') ||
			e.x.includes('preschool') ||
			e.x.includes('elementary') ||
			e.x.includes('junior') ||
			e.x.includes('senior'),
	),
);

// エラー系イベント
const errorEvents = $derived(
	analytics.events.filter((e: { x: string; y: number }) => e.x.includes('error')),
);

// 変化率の表示
function changeRate(current: number, prev: number): string {
	if (prev === 0) return current > 0 ? '+100%' : '0%';
	const rate = ((current - prev) / prev) * 100;
	return `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`;
}

function changeColorClass(current: number, prev: number): string {
	if (current > prev) return 'text-[var(--color-action-success)]';
	if (current < prev) return 'text-[var(--color-action-danger)]';
	return 'text-[var(--color-text-muted)]';
}
</script>

<svelte:head>
	<title>アナリティクス - 管理画面</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<h1 class="text-xl font-bold text-[var(--color-text)]">アナリティクス</h1>

	{#if !analytics.configured}
		<Alert variant="info">
			<p class="font-semibold">Umami が設定されていません</p>
			<p class="text-sm mt-1">
				アナリティクスを有効にするには、環境変数 <code>PUBLIC_UMAMI_WEBSITE_ID</code> と
				<code>PUBLIC_UMAMI_HOST</code> を設定してください。
				API アクセスには <code>UMAMI_API_KEY</code> も必要です。
			</p>
		</Alert>
	{:else if analytics.error}
		<Alert variant="warning">
			<p class="font-semibold">データ取得に失敗しました</p>
			<p class="text-sm mt-1">{analytics.error}</p>
		</Alert>
	{:else if analytics.stats}
		<!-- 1. 概要カード: pageviews / unique visitors -->
		<section>
			<h2 class="section-title">過去 30 日間の概要</h2>
			<div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">ページビュー</div>
					<div class="kpi-value">{analytics.stats.pageviews.value.toLocaleString()}</div>
					<div class="text-xs mt-1 {changeColorClass(analytics.stats.pageviews.value, analytics.stats.pageviews.prev)}">
						{changeRate(analytics.stats.pageviews.value, analytics.stats.pageviews.prev)} (前期比)
					</div>
				</Card>
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">ユニーク訪問者</div>
					<div class="kpi-value">{analytics.stats.visitors.value.toLocaleString()}</div>
					<div class="text-xs mt-1 {changeColorClass(analytics.stats.visitors.value, analytics.stats.visitors.prev)}">
						{changeRate(analytics.stats.visitors.value, analytics.stats.visitors.prev)} (前期比)
					</div>
				</Card>
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">訪問数</div>
					<div class="kpi-value">{analytics.stats.visits.value.toLocaleString()}</div>
					<div class="text-xs mt-1 {changeColorClass(analytics.stats.visits.value, analytics.stats.visits.prev)}">
						{changeRate(analytics.stats.visits.value, analytics.stats.visits.prev)} (前期比)
					</div>
				</Card>
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">直帰率</div>
					<div class="kpi-value">
						{analytics.stats.visits.value > 0
							? ((analytics.stats.bounces.value / analytics.stats.visits.value) * 100).toFixed(1)
							: '0'}%
					</div>
				</Card>
			</div>
		</section>

		<!-- 2. ページ別訪問数 -->
		{#if analytics.pages.length > 0}
			<section>
				<Card padding="lg">
					<h2 class="section-title m-0 mb-3">ページ別訪問数 (トップ 10)</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>ページ</th>
								<th class="analytics-num">訪問数</th>
							</tr>
						</thead>
						<tbody>
							{#each analytics.pages as p}
								<tr>
									<td class="max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">{p.x}</td>
									<td class="analytics-num">{p.y.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Card>
			</section>
		{/if}

		<!-- 3. リファラ -->
		{#if analytics.referrers.length > 0}
			<section>
				<Card padding="lg">
					<h2 class="section-title m-0 mb-3">流入元 (リファラ)</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>参照元</th>
								<th class="analytics-num">訪問数</th>
							</tr>
						</thead>
						<tbody>
							{#each analytics.referrers as ref}
								<tr>
									<td class="max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
										{ref.x || '(直接アクセス)'}
									</td>
									<td class="analytics-num">{ref.y.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Card>
			</section>
		{/if}

		<!-- 4. 年齢モード別イベント -->
		{#if uiModeEvents.length > 0}
			<section>
				<Card padding="lg">
					<h2 class="section-title m-0 mb-3">年齢モード別イベント</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>イベント</th>
								<th class="analytics-num">件数</th>
							</tr>
						</thead>
						<tbody>
							{#each uiModeEvents as evt}
								<tr>
									<td>{evt.x}</td>
									<td class="analytics-num">{evt.y.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Card>
			</section>
		{/if}

		<!-- 5. エラー発生数 -->
		{#if errorEvents.length > 0}
			<section>
				<Card padding="lg">
					<h2 class="section-title m-0 mb-3">エラーイベント</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>イベント</th>
								<th class="analytics-num">件数</th>
							</tr>
						</thead>
						<tbody>
							{#each errorEvents as evt}
								<tr>
									<td>{evt.x}</td>
									<td class="analytics-num">{evt.y.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Card>
			</section>
		{/if}

		<!-- 全イベント一覧 -->
		{#if analytics.events.length > 0}
			<section>
				<Card padding="lg">
					<h2 class="section-title m-0 mb-3">イベント一覧 (トップ 20)</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>イベント名</th>
								<th class="analytics-num">件数</th>
							</tr>
						</thead>
						<tbody>
							{#each analytics.events as evt}
								<tr>
									<td>{evt.x}</td>
									<td class="analytics-num">{evt.y.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Card>
			</section>
		{/if}
	{/if}
</div>

<style>
	.section-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 0.75rem;
	}

	.kpi-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.kpi-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.analytics-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.analytics-table th,
	.analytics-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border-light);
	}

	.analytics-table th {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.analytics-num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>

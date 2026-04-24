<script lang="ts">
import { ANALYTICS_LABELS } from '$lib/domain/labels';
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
	<title>{ANALYTICS_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<h1 class="text-xl font-bold text-[var(--color-text)]">{ANALYTICS_LABELS.pageHeading}</h1>

	{#if !analytics.configured}
		<Alert variant="info">
			<p class="font-semibold">{ANALYTICS_LABELS.umamiNotConfiguredTitle}</p>
			<p class="text-sm mt-1">
				{ANALYTICS_LABELS.umamiConfigVar1Prefix}<code>PUBLIC_UMAMI_WEBSITE_ID</code>{ANALYTICS_LABELS.umamiConfigVar1Suffix}
				<code>PUBLIC_UMAMI_HOST</code>{ANALYTICS_LABELS.umamiConfigVar2Suffix}
				{ANALYTICS_LABELS.umamiConfigApiKeyPrefix}<code>UMAMI_API_KEY</code>{ANALYTICS_LABELS.umamiConfigApiKeySuffix}
			</p>
		</Alert>
	{:else if analytics.error}
		<Alert variant="warning">
			<p class="font-semibold">{ANALYTICS_LABELS.umamiErrorTitle}</p>
			<p class="text-sm mt-1">{analytics.error}</p>
		</Alert>
	{:else if analytics.stats}
		<!-- 1. 概要カード: pageviews / unique visitors -->
		<section>
			<h2 class="section-title">{ANALYTICS_LABELS.overviewTitle}</h2>
			<div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">{ANALYTICS_LABELS.kpiLabelPageViews}</div>
					<div class="kpi-value">{analytics.stats.pageviews.value.toLocaleString()}</div>
					<div class="text-xs mt-1 {changeColorClass(analytics.stats.pageviews.value, analytics.stats.pageviews.prev)}">
						{ANALYTICS_LABELS.prevPeriodCompare(changeRate(analytics.stats.pageviews.value, analytics.stats.pageviews.prev))}
					</div>
				</Card>
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">{ANALYTICS_LABELS.kpiLabelUniqueVisitors}</div>
					<div class="kpi-value">{analytics.stats.visitors.value.toLocaleString()}</div>
					<div class="text-xs mt-1 {changeColorClass(analytics.stats.visitors.value, analytics.stats.visitors.prev)}">
						{ANALYTICS_LABELS.prevPeriodCompare(changeRate(analytics.stats.visitors.value, analytics.stats.visitors.prev))}
					</div>
				</Card>
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">{ANALYTICS_LABELS.kpiLabelVisits}</div>
					<div class="kpi-value">{analytics.stats.visits.value.toLocaleString()}</div>
					<div class="text-xs mt-1 {changeColorClass(analytics.stats.visits.value, analytics.stats.visits.prev)}">
						{ANALYTICS_LABELS.prevPeriodCompare(changeRate(analytics.stats.visits.value, analytics.stats.visits.prev))}
					</div>
				</Card>
				<Card padding="none" class="p-4 text-center">
					<div class="kpi-label">{ANALYTICS_LABELS.kpiLabelBounceRate}</div>
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
					<h2 class="section-title m-0 mb-3">{ANALYTICS_LABELS.pagesTitle}</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>{ANALYTICS_LABELS.tableColPage}</th>
								<th class="analytics-num">{ANALYTICS_LABELS.tableColVisits}</th>
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
					<h2 class="section-title m-0 mb-3">{ANALYTICS_LABELS.referrersTitle}</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>{ANALYTICS_LABELS.tableColReferrer}</th>
								<th class="analytics-num">{ANALYTICS_LABELS.tableColVisits}</th>
							</tr>
						</thead>
						<tbody>
							{#each analytics.referrers as ref}
								<tr>
									<td class="max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
										{ref.x || ANALYTICS_LABELS.directAccess}
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
					<h2 class="section-title m-0 mb-3">{ANALYTICS_LABELS.uiModeEventsTitle}</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>{ANALYTICS_LABELS.tableColEvent}</th>
								<th class="analytics-num">{ANALYTICS_LABELS.tableColCount}</th>
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
					<h2 class="section-title m-0 mb-3">{ANALYTICS_LABELS.errorEventsTitle}</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>{ANALYTICS_LABELS.tableColEvent}</th>
								<th class="analytics-num">{ANALYTICS_LABELS.tableColCount}</th>
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
					<h2 class="section-title m-0 mb-3">{ANALYTICS_LABELS.allEventsTitle}</h2>
					<table class="analytics-table">
						<thead>
							<tr>
								<th>{ANALYTICS_LABELS.tableColEventName}</th>
								<th class="analytics-num">{ANALYTICS_LABELS.tableColCount}</th>
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

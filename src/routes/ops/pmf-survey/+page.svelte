<script lang="ts">
import { PMF_SURVEY_LABELS } from '$lib/domain/labels';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();

const labels = PMF_SURVEY_LABELS;
const aggregation = $derived(data.aggregation);
// svelte-ignore state_referenced_locally — 初期値として data.searchQuery を参照、以降は $effect で同期
let searchInput = $state(data.searchQuery ?? '');
$effect(() => {
	// URL の searchQuery が変わった (戻る/進む等) ら入力欄も同期
	searchInput = data.searchQuery ?? '';
});

function fmtPct(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function fmtDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
	} catch {
		return iso;
	}
}

/** Q1 各バーの幅 % (0-100 スケール) */
function q1BarWidth(key: 'very' | 'somewhat' | 'not' | 'na'): number {
	const v = aggregation.q1Percentages[key];
	return Math.max(0, Math.min(100, v * 100));
}

/** Sean Ellis Score バーの幅 % (40% threshold を超えたら緑) */
const scoreBarWidth = $derived(Math.max(0, Math.min(100, aggregation.seanEllisScore * 100)));
const isAchieved = $derived(aggregation.pmfAchieved);

/** Q3 内訳の合計 (% 表示用) */
const q3Total = $derived(
	aggregation.q3Counts.lp +
		aggregation.q3Counts.media +
		aggregation.q3Counts.friend +
		aggregation.q3Counts.google +
		aggregation.q3Counts.sns +
		aggregation.q3Counts.other,
);

function q3Pct(count: number): string {
	if (q3Total === 0) return '0%';
	return `${((count / q3Total) * 100).toFixed(0)}%`;
}
</script>

<svelte:head>
	<title>{labels.opsPageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="page">
	<header class="page-header">
		<h2 class="page-title">{labels.opsHeading}</h2>
		<p class="page-desc">{labels.opsDescription}</p>
	</header>

	<!-- Round 選択 -->
	<form method="get" class="round-selector">
		<label for="round-select">{labels.opsRoundLabel}:</label>
		<select id="round-select" name="round" onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}>
			{#each data.availableRounds as r (r)}
				<option value={r} selected={r === data.selectedRound}>{r}</option>
			{/each}
		</select>
	</form>

	<!-- KPI サマリー -->
	<div class="kpi-grid">
		<Card padding="none" class="p-5">
			<div class="kpi-label">{labels.opsTotalLabel}</div>
			<div class="kpi-value">{aggregation.totalResponses}</div>
		</Card>
		<Card padding="none" class="p-5">
			<div class="kpi-label">{labels.opsScoreLabel}</div>
			<div class="kpi-value" class:kpi-achieved={isAchieved}>
				{fmtPct(aggregation.seanEllisScore)}
			</div>
			<div class="kpi-status">
				{#if isAchieved}
					<Badge variant="success">{labels.opsAchievedLabel}</Badge>
				{:else}
					<Badge variant="neutral">{labels.opsNotAchievedLabel}</Badge>
				{/if}
			</div>
		</Card>
	</div>

	{#if aggregation.totalResponses === 0}
		<Card>
			<p class="empty">{labels.opsNoDataLabel}</p>
		</Card>
	{:else}
		<!-- Sean Ellis Score バー (40% threshold 強調) -->
		<Card>
			<h3 class="section-heading">{labels.opsScoreLabel}</h3>
			<div class="score-bar-wrap">
				<div class="score-bar-track">
					<div
						class="score-bar-fill"
						class:score-fill-achieved={isAchieved}
						style:width="{scoreBarWidth}%"
					></div>
					<div class="score-threshold-line" aria-label={labels.opsThresholdLabel}>
						<span class="score-threshold-label">{labels.opsThresholdLabel}</span>
					</div>
				</div>
				<div class="score-axis">
					<span>0%</span>
					<span>40%</span>
					<span>100%</span>
				</div>
			</div>
		</Card>

		<!-- Q1 内訳 bar chart -->
		<Card>
			<h3 class="section-heading">{labels.opsBreakdownHeading}</h3>
			<div class="breakdown">
				{#each ['very', 'somewhat', 'not', 'na'] as const as k (k)}
					<div class="bar-row">
						<div class="bar-label">{labels.opsBreakdownBars[k]}</div>
						<div class="bar-track">
							<div
								class="bar-fill bar-fill-{k}"
								style:width="{q1BarWidth(k)}%"
							></div>
						</div>
						<div class="bar-value">
							{aggregation.q1Counts[k]} ({fmtPct(aggregation.q1Percentages[k])})
						</div>
					</div>
				{/each}
			</div>
		</Card>

		<!-- Q3 認知経路 -->
		<Card>
			<h3 class="section-heading">{labels.opsAcquisitionHeading}</h3>
			<table class="table">
				<thead>
					<tr>
						<th>{labels.opsAcquisitionTableChannel}</th>
						<th class="num-col">{labels.opsAcquisitionTableCount}</th>
						<th class="num-col">{labels.opsAcquisitionTableShare}</th>
					</tr>
				</thead>
				<tbody>
					{#each Object.entries(labels.q3Options) as [key, label] (key)}
						<tr>
							<td>{label}</td>
							<td class="num-col">{aggregation.q3Counts[key as keyof typeof labels.q3Options]}</td>
							<td class="num-col">{q3Pct(aggregation.q3Counts[key as keyof typeof labels.q3Options])}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card>

		<!-- 自由記述検索 (AC12, PO 承認 2026-04-29) -->
		<Card>
			<h3 class="section-heading">{labels.opsSearchHeading}</h3>
			<form method="get" class="search-form" data-testid="pmf-survey-search-form">
				<input type="hidden" name="round" value={data.selectedRound} />
				<div class="search-row">
					<FormField
						type="search"
						label={labels.opsSearchLabel}
						name="q"
						bind:value={searchInput}
						hint={labels.opsSearchHint}
						placeholder={labels.opsSearchPlaceholder}
						maxlength={100}
						class="search-input"
					/>
					<div class="search-actions">
						<Button type="submit" variant="primary">{labels.opsSearchSubmitLabel}</Button>
						{#if data.searchQuery}
							<Button type="submit" variant="ghost" name="q" value="">
								{labels.opsSearchClearLabel}
							</Button>
						{/if}
					</div>
				</div>
				{#if data.searchQuery}
					<p class="search-active" data-testid="pmf-survey-search-active">
						{labels.opsSearchActiveLabel(data.searchQuery)}
					</p>
				{/if}
			</form>
		</Card>

		<!-- Q2 自由記述 -->
		<Card>
			<h3 class="section-heading">{labels.opsBenefitsHeading}</h3>
			{#if data.searchQuery}
				<p class="search-result-count" data-testid="pmf-survey-q2-count">
					{labels.opsSearchResultCount(aggregation.q2Texts.length, data.q2TotalCount)}
				</p>
			{/if}
			{#if aggregation.q2Texts.length === 0}
				<p class="empty">
					{data.searchQuery ? labels.opsSearchNoMatch : labels.opsResponseEmpty}
				</p>
			{:else}
				<ul class="text-list">
					{#each aggregation.q2Texts as t (t.tenantId + t.answeredAt)}
						<li class="text-row">
							<div class="text-meta">
								<span>{labels.opsResponseTenantLabel}: {t.tenantId.slice(0, 8)}…</span>
								<span>{labels.opsResponseDateLabel}: {fmtDate(t.answeredAt)}</span>
							</div>
							<p class="text-body">{t.text}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<!-- Q4 自由記述 -->
		<Card>
			<h3 class="section-heading">{labels.opsDisappointmentHeading}</h3>
			{#if data.searchQuery}
				<p class="search-result-count" data-testid="pmf-survey-q4-count">
					{labels.opsSearchResultCount(aggregation.q4Texts.length, data.q4TotalCount)}
				</p>
			{/if}
			{#if aggregation.q4Texts.length === 0}
				<p class="empty">
					{data.searchQuery ? labels.opsSearchNoMatch : labels.opsResponseEmpty}
				</p>
			{:else}
				<ul class="text-list">
					{#each aggregation.q4Texts as t (t.tenantId + t.answeredAt)}
						<li class="text-row">
							<div class="text-meta">
								<span>{labels.opsResponseTenantLabel}: {t.tenantId.slice(0, 8)}…</span>
								<span>{labels.opsResponseDateLabel}: {fmtDate(t.answeredAt)}</span>
							</div>
							<p class="text-body">{t.text}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}
</div>

<style>
.page {
	display: flex;
	flex-direction: column;
	gap: 1.5rem;
}

.page-header {
	margin-bottom: 0.5rem;
}

.page-title {
	font-size: 1.125rem;
	font-weight: 700;
	margin: 0 0 0.5rem;
	color: var(--color-text);
}

.page-desc {
	font-size: 0.875rem;
	color: var(--color-text-muted);
	margin: 0;
	line-height: 1.6;
}

.round-selector {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.875rem;
}

.round-selector select {
	padding: 0.25rem 0.5rem;
	border: 1px solid var(--color-border);
	border-radius: 0.375rem;
	background: var(--color-surface);
}

.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 1rem;
}

.kpi-label {
	font-size: 0.75rem;
	color: var(--color-text-muted);
	margin-bottom: 0.25rem;
}

.kpi-value {
	font-size: 2rem;
	font-weight: 700;
	color: var(--color-text);
}

.kpi-achieved {
	color: var(--color-feedback-success-text);
}

.kpi-status {
	margin-top: 0.5rem;
}

.section-heading {
	font-size: 0.95rem;
	font-weight: 700;
	margin: 0 0 1rem;
	color: var(--color-text);
}

.empty {
	color: var(--color-text-muted);
	font-size: 0.875rem;
	margin: 0;
}

/* Sean Ellis Score bar */
.score-bar-wrap {
	margin: 1rem 0;
}

.score-bar-track {
	position: relative;
	height: 32px;
	background: var(--color-surface-muted);
	border-radius: 16px;
	overflow: hidden;
}

.score-bar-fill {
	position: absolute;
	top: 0;
	left: 0;
	bottom: 0;
	background: var(--color-feedback-warning-bg-strong);
	transition: width 0.3s ease;
}

.score-fill-achieved {
	background: var(--color-feedback-success-bg-strong);
}

.score-threshold-line {
	position: absolute;
	top: -4px;
	bottom: -4px;
	left: 40%;
	width: 2px;
	background: var(--color-feedback-error-text);
}

.score-threshold-label {
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	top: -22px;
	font-size: 0.65rem;
	font-weight: 700;
	color: var(--color-feedback-error-text);
	white-space: nowrap;
}

.score-axis {
	display: flex;
	justify-content: space-between;
	margin-top: 8px;
	font-size: 0.7rem;
	color: var(--color-text-muted);
}

/* Q1 breakdown bar chart */
.breakdown {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.bar-row {
	display: grid;
	grid-template-columns: 8rem 1fr 7rem;
	align-items: center;
	gap: 0.75rem;
	font-size: 0.875rem;
}

.bar-label {
	color: var(--color-text-secondary);
}

.bar-track {
	height: 18px;
	background: var(--color-surface-muted);
	border-radius: 9px;
	overflow: hidden;
}

.bar-fill {
	height: 100%;
	transition: width 0.3s ease;
}

.bar-fill-very {
	background: var(--color-feedback-success-bg-strong);
}

.bar-fill-somewhat {
	background: var(--color-feedback-warning-bg-strong);
}

.bar-fill-not {
	background: var(--color-feedback-error-bg-strong);
}

.bar-fill-na {
	background: var(--color-surface-tertiary);
}

.bar-value {
	font-variant-numeric: tabular-nums;
	color: var(--color-text);
	text-align: right;
}

/* Q3 table */
.table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.875rem;
}

.table th,
.table td {
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid var(--color-border-light);
	text-align: left;
}

.table th {
	background: var(--color-surface-muted);
	font-weight: 600;
}

.num-col {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* Free-text list */
.text-list {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.text-row {
	padding: 0.75rem;
	background: var(--color-surface-muted);
	border-radius: 0.5rem;
}

.text-meta {
	display: flex;
	gap: 1rem;
	font-size: 0.7rem;
	color: var(--color-text-muted);
	margin-bottom: 0.5rem;
}

.text-body {
	margin: 0;
	color: var(--color-text);
	line-height: 1.6;
	white-space: pre-wrap;
	word-break: break-word;
}

/* AC12 free-text search (PO approved 2026-04-29) */
.search-form {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.search-row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.75rem;
	align-items: flex-end;
}

.search-row :global(.search-input) {
	flex: 1 1 240px;
	min-width: 0;
}

.search-actions {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}

.search-active {
	margin: 0;
	font-size: 0.8rem;
	color: var(--color-text-secondary);
	font-weight: 600;
}

.search-result-count {
	margin: 0 0 0.75rem;
	font-size: 0.8rem;
	color: var(--color-text-muted);
}
</style>

<script lang="ts">
import {
	ANALYTICS_LABELS,
	type CancellationCategory,
	getCancellationCategoryLabel,
} from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();

const labels = ANALYTICS_LABELS;

function fmtPct(value: number | null): string {
	if (value === null || Number.isNaN(value)) return labels.retentionCohortNotYet;
	return `${(value * 100).toFixed(1)}%`;
}

function fmtCount(n: number): string {
	return `${n.toLocaleString('ja-JP')}${labels.countSuffix}`;
}

function fmtDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
	} catch {
		return iso;
	}
}

function funnelStepLabel(eventName: string): string {
	const map = labels.activationFunnelStepLabels;
	return map[eventName as keyof typeof map] ?? eventName;
}

function funnelBarWidth(count: number, max: number): number {
	if (max <= 0) return 0;
	return Math.max(0, Math.min(100, (count / max) * 100));
}

const funnelMax = $derived(data.funnel ? Math.max(0, ...data.funnel.steps.map((s) => s.count)) : 0);

const seanEllisScorePct = $derived(
	data.seanEllis ? Math.max(0, Math.min(100, data.seanEllis.seanEllisScore * 100)) : 0,
);

function cancellationBarWidth(percentage: number): number {
	return Math.max(0, Math.min(100, percentage));
}
</script>

<svelte:head>
	<title>{labels.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1 class="page-title">{labels.pageHeading}</h1>
		<p class="page-desc">{labels.pageDescription}</p>
	</header>

	<!-- AC1: Activation Funnel -->
	<Card>
		<div class="section-header">
			<h2 class="section-heading">{labels.activationFunnelHeading}</h2>
			<form method="get" class="period-form">
				<input type="hidden" name="cohortPeriod" value={data.cohortPeriod} />
				<input type="hidden" name="cancelPeriod" value={data.cancelPeriod} />
				<input type="hidden" name="round" value={data.round} />
				<label for="funnel-period">{labels.periodLabel}:</label>
				<select
					id="funnel-period"
					name="funnelPeriod"
					onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
				>
					<option value="7d" selected={data.funnelPeriod === '7d'}>{labels.period7d}</option>
					<option value="30d" selected={data.funnelPeriod === '30d'}>{labels.period30d}</option>
				</select>
			</form>
		</div>
		<p class="section-desc">{labels.activationFunnelDesc}</p>

		{#if data.errors.funnel}
			<Alert variant="danger">{labels.fetchErrorLabel}: {data.errors.funnel}</Alert>
		{:else if !data.funnel || data.funnel.steps.every((s) => s.count === 0)}
			<p class="empty">{labels.noDataLabel}</p>
		{:else}
			<div class="funnel">
				{#each data.funnel.steps as step (step.eventName)}
					<div class="funnel-row">
						<div class="funnel-label">{step.step}. {funnelStepLabel(step.eventName)}</div>
						<div class="funnel-bar-track">
							<div
								class="funnel-bar-fill"
								style:width="{funnelBarWidth(step.count, funnelMax)}%"
							></div>
						</div>
						<div class="funnel-value">
							{step.count.toLocaleString('ja-JP')}{labels.tenantSuffix}
							{#if step.step > 1}
								<span class="funnel-conversion">({fmtPct(step.conversionFromPrev)})</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			<p class="fetched-at">{labels.fetchedAtLabel}: {fmtDate(data.funnel.fetchedAt)}</p>
		{/if}
	</Card>

	<!-- AC2: Retention Cohort -->
	<Card>
		<div class="section-header">
			<h2 class="section-heading">{labels.retentionCohortHeading}</h2>
			<form method="get" class="period-form">
				<input type="hidden" name="funnelPeriod" value={data.funnelPeriod} />
				<input type="hidden" name="cancelPeriod" value={data.cancelPeriod} />
				<input type="hidden" name="round" value={data.round} />
				<label for="cohort-period">{labels.periodLabel}:</label>
				<select
					id="cohort-period"
					name="cohortPeriod"
					onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
				>
					<option value="weekly" selected={data.cohortPeriod === 'weekly'}>{labels.periodWeekly}</option>
					<option value="monthly" selected={data.cohortPeriod === 'monthly'}>{labels.periodMonthly}</option>
				</select>
			</form>
		</div>
		<p class="section-desc">{labels.retentionCohortDesc}</p>

		{#if data.errors.cohort}
			<Alert variant="danger">{labels.fetchErrorLabel}: {data.errors.cohort}</Alert>
		{:else if !data.cohort || data.cohort.cohorts.length === 0}
			<p class="empty">{labels.noDataLabel}</p>
		{:else}
			<div class="table-wrap">
				<table class="cohort-table">
					<thead>
						<tr>
							<th>{labels.retentionCohortHeading_cohort}</th>
							<th class="num-col">{labels.retentionCohortHeading_size}</th>
							{#each data.cohort.dayPoints as d (d)}
								<th class="num-col">{labels.retentionCohortDayHeading(d)}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.cohort.cohorts as row (row.cohort)}
							<tr>
								<td>
									{row.cohort}
									{#if row.insufficientSample}
										<Badge variant="neutral">{labels.retentionCohortInsufficientSample}</Badge>
									{/if}
								</td>
								<td class="num-col">{row.size}</td>
								{#each data.cohort.dayPoints as d (d)}
									<td class="num-col">{fmtPct(row.retention[d] ?? null)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="fetched-at">{labels.fetchedAtLabel}: {fmtDate(data.cohort.fetchedAt)}</p>
		{/if}
	</Card>

	<!-- AC3: Sean Ellis Score -->
	<Card>
		<div class="section-header">
			<h2 class="section-heading">{labels.seanEllisHeading}</h2>
			<form method="get" class="period-form">
				<input type="hidden" name="funnelPeriod" value={data.funnelPeriod} />
				<input type="hidden" name="cohortPeriod" value={data.cohortPeriod} />
				<input type="hidden" name="cancelPeriod" value={data.cancelPeriod} />
				<label for="sean-round">{labels.seanEllisRoundLabel}:</label>
				<input
					id="sean-round"
					type="text"
					name="round"
					value={data.round}
					pattern="\d{'{4}'}-H[12]"
					placeholder="2026-H1"
					onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
				/>
			</form>
		</div>
		<p class="section-desc">{labels.seanEllisDesc}</p>

		{#if data.errors.seanEllis}
			<Alert variant="danger">{labels.fetchErrorLabel}: {data.errors.seanEllis}</Alert>
		{:else if !data.seanEllis || data.seanEllis.totalResponses === 0}
			<p class="empty">{labels.noDataLabel}</p>
		{:else}
			<div class="sean-grid">
				<div class="sean-stat">
					<div class="stat-label">{labels.seanEllisScoreLabel}</div>
					<div class="stat-value" class:stat-achieved={data.seanEllis.pmfAchieved}>
						{fmtPct(data.seanEllis.seanEllisScore)}
					</div>
					<div class="stat-status">
						{#if data.seanEllis.pmfAchieved}
							<Badge variant="success">{labels.seanEllisAchieved}</Badge>
						{:else}
							<Badge variant="neutral">{labels.seanEllisNotAchieved}</Badge>
						{/if}
					</div>
				</div>
				<div class="sean-stat">
					<div class="stat-label">{labels.seanEllisTotalResponses}</div>
					<div class="stat-value">{data.seanEllis.totalResponses}</div>
				</div>
			</div>
			<div class="sean-bar-wrap">
				<div class="sean-bar-track">
					<div
						class="sean-bar-fill"
						class:sean-fill-achieved={data.seanEllis.pmfAchieved}
						style:width="{seanEllisScorePct}%"
					></div>
					<div class="sean-threshold-line" aria-label="40% threshold"></div>
				</div>
				<div class="sean-axis">
					<span>0%</span>
					<span>40%</span>
					<span>100%</span>
				</div>
			</div>
			<p class="ops-link">
				<a href="/ops/pmf-survey?round={data.round}">{labels.seanEllisOpsLink} →</a>
			</p>
		{/if}
	</Card>

	<!-- AC4: Cancellation Reasons -->
	<Card>
		<div class="section-header">
			<h2 class="section-heading">{labels.cancellationReasonsHeading}</h2>
			<form method="get" class="period-form">
				<input type="hidden" name="funnelPeriod" value={data.funnelPeriod} />
				<input type="hidden" name="cohortPeriod" value={data.cohortPeriod} />
				<input type="hidden" name="round" value={data.round} />
				<label for="cancel-period">{labels.periodLabel}:</label>
				<select
					id="cancel-period"
					name="cancelPeriod"
					onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
				>
					<option value="30d" selected={data.cancelPeriod === '30d'}>{labels.period30d}</option>
					<option value="90d" selected={data.cancelPeriod === '90d'}>{labels.period90d}</option>
				</select>
			</form>
		</div>
		<p class="section-desc">{labels.cancellationReasonsDesc}</p>

		{#if data.errors.cancellation}
			<Alert variant="danger">{labels.fetchErrorLabel}: {data.errors.cancellation}</Alert>
		{:else if !data.cancellation || data.cancellation.total === 0}
			<p class="empty">{labels.noDataLabel}</p>
		{:else}
			<p class="cancel-total">{labels.totalLabel}: {fmtCount(data.cancellation.total)}</p>
			<div class="cancel-list">
				{#each data.cancellation.breakdown as row (row.category)}
					<div class="cancel-row">
						<div class="cancel-label">
							{getCancellationCategoryLabel(row.category as CancellationCategory)}
						</div>
						<div class="cancel-bar-track">
							<div
								class="cancel-bar-fill"
								style:width="{cancellationBarWidth(row.percentage)}%"
							></div>
						</div>
						<div class="cancel-value">
							{row.count}{labels.countSuffix} ({row.percentage.toFixed(1)}%)
						</div>
					</div>
				{/each}
			</div>
			<p class="fetched-at">{labels.fetchedAtLabel}: {fmtDate(data.cancellation.fetchedAt)}</p>
		{/if}
	</Card>
</div>

<style>
.page {
	display: flex;
	flex-direction: column;
	gap: 1.5rem;
}

.page-header {
	margin-bottom: 0.25rem;
}

.page-title {
	font-size: 1.25rem;
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

.section-header {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: baseline;
	gap: 0.75rem;
	margin-bottom: 0.5rem;
}

.section-heading {
	font-size: 1rem;
	font-weight: 700;
	margin: 0;
	color: var(--color-text);
}

.section-desc {
	font-size: 0.8rem;
	color: var(--color-text-muted);
	margin: 0 0 1rem;
	line-height: 1.6;
}

.period-form {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.8rem;
}

.period-form select,
.period-form input[type='text'] {
	padding: 0.25rem 0.5rem;
	border: 1px solid var(--color-border);
	border-radius: 0.375rem;
	background: var(--color-surface);
	font-size: 0.8rem;
}

.empty {
	color: var(--color-text-muted);
	font-size: 0.875rem;
	margin: 0;
}

.fetched-at {
	margin: 1rem 0 0;
	font-size: 0.7rem;
	color: var(--color-text-muted);
	text-align: right;
}

/* Activation funnel */
.funnel {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.funnel-row {
	display: grid;
	grid-template-columns: 12rem 1fr 12rem;
	align-items: center;
	gap: 0.75rem;
	font-size: 0.875rem;
}

.funnel-label {
	color: var(--color-text-secondary);
}

.funnel-bar-track {
	height: 22px;
	background: var(--color-surface-muted);
	border-radius: 11px;
	overflow: hidden;
}

.funnel-bar-fill {
	height: 100%;
	background: var(--color-feedback-info-bg-strong);
	transition: width 0.3s ease;
}

.funnel-value {
	font-variant-numeric: tabular-nums;
	color: var(--color-text);
	text-align: right;
}

.funnel-conversion {
	color: var(--color-text-muted);
	margin-left: 0.25rem;
	font-size: 0.75rem;
}

/* Retention cohort table */
.table-wrap {
	overflow-x: auto;
}

.cohort-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.875rem;
	min-width: 480px;
}

.cohort-table th,
.cohort-table td {
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid var(--color-border-light);
	text-align: left;
}

.cohort-table th {
	background: var(--color-surface-muted);
	font-weight: 600;
	font-size: 0.8rem;
}

.num-col {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* Sean Ellis */
.sean-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: 1rem;
	margin-bottom: 1rem;
}

.sean-stat {
	padding: 0.75rem;
	background: var(--color-surface-muted);
	border-radius: 0.5rem;
}

.stat-label {
	font-size: 0.75rem;
	color: var(--color-text-muted);
	margin-bottom: 0.25rem;
}

.stat-value {
	font-size: 1.5rem;
	font-weight: 700;
	color: var(--color-text);
}

.stat-achieved {
	color: var(--color-feedback-success-text);
}

.stat-status {
	margin-top: 0.5rem;
}

.sean-bar-wrap {
	margin: 1rem 0;
}

.sean-bar-track {
	position: relative;
	height: 28px;
	background: var(--color-surface-muted);
	border-radius: 14px;
	overflow: hidden;
}

.sean-bar-fill {
	position: absolute;
	top: 0;
	left: 0;
	bottom: 0;
	background: var(--color-feedback-warning-bg-strong);
	transition: width 0.3s ease;
}

.sean-fill-achieved {
	background: var(--color-feedback-success-bg-strong);
}

.sean-threshold-line {
	position: absolute;
	top: -4px;
	bottom: -4px;
	left: 40%;
	width: 2px;
	background: var(--color-feedback-error-text);
}

.sean-axis {
	display: flex;
	justify-content: space-between;
	margin-top: 6px;
	font-size: 0.7rem;
	color: var(--color-text-muted);
}

.ops-link {
	margin: 0.5rem 0 0;
	font-size: 0.85rem;
}

.ops-link a {
	color: var(--color-text-link);
	text-decoration: none;
}

.ops-link a:hover {
	text-decoration: underline;
}

/* Cancellation reasons */
.cancel-total {
	margin: 0 0 1rem;
	font-size: 0.875rem;
	color: var(--color-text);
	font-weight: 600;
}

.cancel-list {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.cancel-row {
	display: grid;
	grid-template-columns: 6rem 1fr 7rem;
	align-items: center;
	gap: 0.75rem;
	font-size: 0.875rem;
}

.cancel-label {
	color: var(--color-text-secondary);
}

.cancel-bar-track {
	height: 18px;
	background: var(--color-surface-muted);
	border-radius: 9px;
	overflow: hidden;
}

.cancel-bar-fill {
	height: 100%;
	background: var(--color-feedback-warning-bg-strong);
	transition: width 0.3s ease;
}

.cancel-value {
	font-variant-numeric: tabular-nums;
	color: var(--color-text);
	text-align: right;
}
</style>

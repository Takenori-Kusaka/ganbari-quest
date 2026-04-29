<script lang="ts">
import {
	type CancellationCategory,
	getCancellationCategoryLabel,
	getPlanLabel,
	OPS_ANALYTICS_LABELS,
	OPS_CANCELLATION_LABELS,
	OPS_GRADUATION_LABELS,
	OPS_PRESET_DISTRIBUTION_LABELS,
} from '$lib/domain/labels';
import type { PresetBucketKey } from '$lib/server/services/ops-analytics-service';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const a = $derived(data.analytics);

// #1602 (ADR-0023 I13): bucket key → ラベル
const PRESET_BUCKET_LABELS: Record<PresetBucketKey, string> = {
	'homework-daily': OPS_PRESET_DISTRIBUTION_LABELS.bucketHomeworkDaily,
	chores: OPS_PRESET_DISTRIBUTION_LABELS.bucketChores,
	'beyond-games': OPS_PRESET_DISTRIBUTION_LABELS.bucketBeyondGames,
	other: OPS_PRESET_DISTRIBUTION_LABELS.bucketOther,
	none: OPS_PRESET_DISTRIBUTION_LABELS.bucketNone,
};

// 棒グラフ幅: 各行の count を最大値で正規化（複数選択で % が 100 超え得るため、
// 視覚バーは max(maxCount, 1) を 100% として相対化する）
const presetMaxCount = $derived(Math.max(1, ...a.presetDistribution.rows.map((r) => r.count)));
function barWidthPct(count: number): number {
	return Math.round((count / presetMaxCount) * 100);
}
</script>

<svelte:head>
	<title>{OPS_ANALYTICS_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{OPS_ANALYTICS_LABELS.fetchedAt(new Date(a.fetchedAt).toLocaleString('ja-JP'))}
	</div>

	<!-- LTV KPI カード -->
	<section>
		<h2 class="ops-section-title">{OPS_ANALYTICS_LABELS.ltvSectionTitle}</h2>
		<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">{OPS_ANALYTICS_LABELS.ltvEstimatedLabel}</div>
				<div class="ops-kpi-value">¥{a.ltv.estimatedLtv.toLocaleString()}</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">{OPS_ANALYTICS_LABELS.ltvEstimatedNote}</div>
			</Card>
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">{OPS_ANALYTICS_LABELS.ltvArpuLabel}</div>
				<div class="ops-kpi-value">¥{a.ltv.monthlyArpu.toLocaleString()}</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">{OPS_ANALYTICS_LABELS.ltvArpuNote(a.ltv.activeSubscribers)}</div>
			</Card>
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">{OPS_ANALYTICS_LABELS.ltvAvgMonthsLabel}</div>
				<div class="ops-kpi-value">{a.ltv.avgLifetimeMonths}</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">{OPS_ANALYTICS_LABELS.ltvAvgMonthsUnit}</div>
			</Card>
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">{OPS_ANALYTICS_LABELS.ltvChurnRateLabel}</div>
				<div class="ops-kpi-value">{a.ltv.churnRate}%</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">{OPS_ANALYTICS_LABELS.ltvChurnedNote(a.ltv.churned)}</div>
			</Card>
		</div>
	</section>

	<!-- プラン別内訳 + MRR -->
	{#if a.planBreakdown.length > 0}
		<section>
			<Card padding="lg">
				<h2 class="ops-section-title m-0 mb-4">{OPS_ANALYTICS_LABELS.planBreakdownTitle}</h2>
				<table class="ops-table">
					<thead>
						<tr>
							<th>{OPS_ANALYTICS_LABELS.planColPlan}</th>
							<th class="ops-num">{OPS_ANALYTICS_LABELS.planColTenants}</th>
							<th class="ops-num">{OPS_ANALYTICS_LABELS.planColMrr}</th>
							<th class="ops-num">{OPS_ANALYTICS_LABELS.planColShare}</th>
						</tr>
					</thead>
					<tbody>
						{#each a.planBreakdown as pb}
							<tr>
								<td>{pb.plan === 'none' ? OPS_ANALYTICS_LABELS.planNone : getPlanLabel(pb.plan)}</td>
								<td class="ops-num">{pb.count}</td>
								<td class="ops-num">¥{pb.mrr.toLocaleString()}</td>
								<td class="ops-num">{pb.percentage}%</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card>
		</section>
	{/if}

	<!-- #1602 (ADR-0023 I13): setup プリセット選択分布 -->
	<section data-testid="ops-preset-distribution">
		<Card padding="lg">
			<h2 class="ops-section-title m-0 mb-1">
				{OPS_PRESET_DISTRIBUTION_LABELS.sectionTitle}
			</h2>
			<p class="text-xs text-[var(--color-text-muted)] mb-3">
				{OPS_PRESET_DISTRIBUTION_LABELS.sectionDesc}
			</p>
			<p class="text-xs text-[var(--color-text-secondary)] mb-3">
				{OPS_PRESET_DISTRIBUTION_LABELS.totalsLabel(
					a.presetDistribution.answeredTenants,
					a.presetDistribution.totalTenants,
				)}
			</p>

			{#if a.presetDistribution.totalTenants === 0}
				<p class="text-sm text-[var(--color-text-muted)]">
					{OPS_PRESET_DISTRIBUTION_LABELS.emptyMessage}
				</p>
			{:else}
				<table class="ops-table">
					<thead>
						<tr>
							<th>{OPS_PRESET_DISTRIBUTION_LABELS.colKey}</th>
							<th class="ops-num">{OPS_PRESET_DISTRIBUTION_LABELS.colCount}</th>
							<th class="ops-num">{OPS_PRESET_DISTRIBUTION_LABELS.colShare}</th>
							<th class="preset-bar-cell">{OPS_PRESET_DISTRIBUTION_LABELS.colBar}</th>
						</tr>
					</thead>
					<tbody>
						{#each a.presetDistribution.rows as row (row.key)}
							<tr data-bucket={row.key}>
								<td>{PRESET_BUCKET_LABELS[row.key]}</td>
								<td class="ops-num">{row.count}</td>
								<td class="ops-num">{row.percentage}%</td>
								<td class="preset-bar-cell">
									<div class="preset-bar-track" aria-hidden="true">
										<div
											class="preset-bar-fill"
											class:preset-bar-fill--other={row.key === 'other'}
											class:preset-bar-fill--none={row.key === 'none'}
											style:width={`${barWidthPct(row.count)}%`}
										></div>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="text-xs text-[var(--color-text-muted)] mt-2">
					{OPS_PRESET_DISTRIBUTION_LABELS.ratioNote}
				</p>
			{/if}
		</Card>
	</section>

	<!-- 月次獲得推移 -->
	{#if a.monthlyAcquisitions.length > 0}
		<section>
			<Card padding="lg">
				<h2 class="ops-section-title m-0 mb-4">{OPS_ANALYTICS_LABELS.acquisitionTitle}</h2>
				<table class="ops-table">
					<thead>
						<tr>
							<th>{OPS_ANALYTICS_LABELS.acquisitionColMonth}</th>
							<th class="ops-num">{OPS_ANALYTICS_LABELS.acquisitionColNew}</th>
						</tr>
					</thead>
					<tbody>
						{#each a.monthlyAcquisitions as ma}
							<tr>
								<td>{ma.month}</td>
								<td class="ops-num">{ma.total}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card>
		</section>
	{/if}

	<!-- コホート分析 -->
	{#if a.cohorts.length > 0}
		<section>
			<Card padding="lg">
				<h2 class="ops-section-title m-0 mb-4">{OPS_ANALYTICS_LABELS.cohortTitle}</h2>
				<div class="overflow-x-auto">
					<table class="ops-table">
						<thead>
							<tr>
								<th>{OPS_ANALYTICS_LABELS.cohortColMonth}</th>
								<th class="ops-num">{OPS_ANALYTICS_LABELS.cohortColSignups}</th>
								{#each { length: Math.max(...a.cohorts.map((c) => c.retention.length)) } as _, i}
									<th class="ops-num">M{i}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each a.cohorts as cohort}
								<tr>
									<td>{cohort.month}</td>
									<td class="ops-num">{cohort.totalSignups}</td>
									{#each cohort.retention as count, i}
										{@const rate = cohort.totalSignups > 0 ? Math.round((count / cohort.totalSignups) * 100) : 0}
										<td class="ops-num">
											<span class="font-semibold">{count}</span>
											<span class="text-xs text-[var(--color-text-muted)] ml-1">({rate}%)</span>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="text-xs text-[var(--color-text-muted)] mt-2">
					{OPS_ANALYTICS_LABELS.cohortNote}
				</p>
			</Card>
		</section>
	{/if}

	<!-- 解約理由集計 (#1596 / ADR-0023 §3.8 / I3) -->
	<section data-testid="ops-cancellation-section">
		<Card padding="lg">
			<h2 class="ops-section-title m-0 mb-1">{OPS_CANCELLATION_LABELS.sectionTitle}</h2>
			<p class="text-xs text-[var(--color-text-muted)] mb-4">
				{OPS_CANCELLATION_LABELS.sectionHint} / {OPS_CANCELLATION_LABELS.totalLabel(a.cancellationReasons.total)}
			</p>

			{#if a.cancellationReasons.total === 0}
				<p class="text-sm text-[var(--color-text-muted)]" data-testid="ops-cancellation-empty">
					{OPS_CANCELLATION_LABELS.noData}
				</p>
			{:else}
				<table class="ops-table" data-testid="ops-cancellation-breakdown">
					<thead>
						<tr>
							<th>{OPS_CANCELLATION_LABELS.colCategory}</th>
							<th class="ops-num">{OPS_CANCELLATION_LABELS.colCount}</th>
							<th class="ops-num">{OPS_CANCELLATION_LABELS.colPercentage}</th>
						</tr>
					</thead>
					<tbody>
						{#each a.cancellationReasons.breakdown as row}
							<tr>
								<td>{getCancellationCategoryLabel(row.category as CancellationCategory)}</td>
								<td class="ops-num">{row.count}</td>
								<td class="ops-num">{row.percentage}%</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<!-- 自由記述サンプル（最低限の検索機能 — 最新 20 件） -->
			<h3 class="ops-section-title m-0 mt-6 mb-2 text-sm">
				{OPS_CANCELLATION_LABELS.freeTextSearchLabel}
			</h3>
			{#if a.cancellationReasons.freeTextSamples.length === 0}
				<p class="text-sm text-[var(--color-text-muted)]" data-testid="ops-cancellation-freetext-empty">
					{OPS_CANCELLATION_LABELS.freeTextEmpty}
				</p>
			{:else}
				<ul class="ops-freetext-list" data-testid="ops-cancellation-freetext-list">
					{#each a.cancellationReasons.freeTextSamples as sample (sample.id)}
						<li class="ops-freetext-item">
							<div class="ops-freetext-meta">
								<span>{OPS_CANCELLATION_LABELS.freeTextDate(new Date(sample.createdAt).toLocaleDateString('ja-JP'))}</span>
								<span>{OPS_CANCELLATION_LABELS.freeTextCategory(getCancellationCategoryLabel(sample.category as CancellationCategory))}</span>
							</div>
							<p class="ops-freetext-body">{sample.freeText}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</section>

	<!-- 卒業フロー集計 (#1603 / ADR-0023 §3.8 / §5 I10) -->
	<section data-testid="ops-graduation-section">
		<Card padding="lg">
			<h2 class="ops-section-title m-0 mb-1">{OPS_GRADUATION_LABELS.sectionTitle}</h2>
			<p class="text-xs text-[var(--color-text-muted)] mb-4">
				{OPS_GRADUATION_LABELS.sectionHint}
			</p>

			{#if a.graduation.totalGraduations === 0}
				<p class="text-sm text-[var(--color-text-muted)]" data-testid="ops-graduation-empty">
					{OPS_GRADUATION_LABELS.noData}
				</p>
			{:else}
				<table class="ops-table" data-testid="ops-graduation-metrics">
					<thead>
						<tr>
							<th>{OPS_GRADUATION_LABELS.colMetric}</th>
							<th class="ops-num">{OPS_GRADUATION_LABELS.colValue}</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>{OPS_GRADUATION_LABELS.metricTotalGraduations}</td>
							<td class="ops-num" data-testid="ops-graduation-total">{a.graduation.totalGraduations}</td>
						</tr>
						<tr>
							<td>{OPS_GRADUATION_LABELS.metricConsentedCount}</td>
							<td class="ops-num" data-testid="ops-graduation-consented">{a.graduation.consentedCount}</td>
						</tr>
						<tr>
							<td>{OPS_GRADUATION_LABELS.metricAvgUsagePeriod}</td>
							<td class="ops-num" data-testid="ops-graduation-usage-avg">{a.graduation.avgUsagePeriodDays}</td>
						</tr>
						<tr>
							<td>{OPS_GRADUATION_LABELS.metricGraduationRate}</td>
							<td class="ops-num" data-testid="ops-graduation-rate">{OPS_GRADUATION_LABELS.graduationRateLabel(a.graduation.graduationRate)}</td>
						</tr>
						<tr>
							<td>{OPS_GRADUATION_LABELS.metricTotalCancellations}</td>
							<td class="ops-num">{a.graduation.totalCancellations}</td>
						</tr>
					</tbody>
				</table>
			{/if}

			<!-- 公開可能な卒業事例 -->
			<h3 class="ops-section-title m-0 mt-6 mb-2 text-sm">
				{OPS_GRADUATION_LABELS.publicSamplesTitle}
			</h3>
			{#if a.graduation.publicSamples.length === 0}
				<p class="text-sm text-[var(--color-text-muted)]" data-testid="ops-graduation-samples-empty">
					{OPS_GRADUATION_LABELS.publicSampleEmpty}
				</p>
			{:else}
				<ul class="ops-freetext-list" data-testid="ops-graduation-samples-list">
					{#each a.graduation.publicSamples as sample (sample.id)}
						<li class="ops-freetext-item">
							<div class="ops-freetext-meta">
								<span>{OPS_GRADUATION_LABELS.publicSampleNickname(sample.nickname)}</span>
								<span>{OPS_GRADUATION_LABELS.publicSampleUsagePeriod(sample.usagePeriodDays)}</span>
								<span>{OPS_GRADUATION_LABELS.publicSamplePoints(sample.userPoints)}</span>
							</div>
							<p class="ops-freetext-body">{sample.message}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</section>

	<!-- Stripe 状態 -->
	<Card padding="lg">
		<h2 class="ops-section-title m-0 mb-4">{OPS_ANALYTICS_LABELS.dataSourceTitle}</h2>
		<div class="flex flex-col gap-2 text-sm">
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-text-secondary)]">{OPS_ANALYTICS_LABELS.stripeLabel}</span>
				<span class={a.stripeEnabled ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-warning)]'}>
					{a.stripeEnabled ? OPS_ANALYTICS_LABELS.stripeEnabled : OPS_ANALYTICS_LABELS.stripeDisabled}
				</span>
			</div>
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-text-secondary)]">{OPS_ANALYTICS_LABELS.pipelineLabel}</span>
				<span class="text-[var(--color-text-muted)]">
					{OPS_ANALYTICS_LABELS.pipelineDesc}
				</span>
			</div>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				{OPS_ANALYTICS_LABELS.costNote}
			</p>
		</div>
	</Card>
</div>

<style>
	.ops-section-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 0.75rem;
	}

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
		color: var(--color-text);
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

	/* #1602: preset distribution bar chart */
	.preset-bar-cell {
		width: 30%;
		min-width: 120px;
	}

	.preset-bar-track {
		width: 100%;
		height: 0.5rem;
		background: var(--color-surface-muted);
		border-radius: var(--radius-sm, 4px);
		overflow: hidden;
	}

	.preset-bar-fill {
		height: 100%;
		background: var(--color-action-primary);
		transition: width 0.3s ease-out;
	}

	.preset-bar-fill--other {
		background: var(--color-text-muted);
	}

	.preset-bar-fill--none {
		background: var(--color-border-strong);
	}

	/* #1596: cancellation reasons free-text list */
	.ops-freetext-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}

	.ops-freetext-item {
		padding: 0.625rem 0.75rem;
		background: var(--color-surface-muted);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md, 8px);
	}

	.ops-freetext-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-bottom: 0.25rem;
		flex-wrap: wrap;
	}

	.ops-freetext-body {
		font-size: 0.85rem;
		color: var(--color-text-primary);
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>

<script lang="ts">
import { getPlanLabel, OPS_ANALYTICS_LABELS } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const a = $derived(data.analytics);
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
</style>

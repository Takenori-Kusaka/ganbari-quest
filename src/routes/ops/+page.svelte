<script lang="ts">
import { OPS_LABELS } from '$lib/domain/labels';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const kpi = $derived(data.kpi);
const stats = $derived(kpi.tenantStats);
const activeRate = $derived((kpi.activeRate * 100).toFixed(1));
const triggerReport = $derived(data.triggerReport);
const firedTriggers = $derived(triggerReport.firedTriggers);
const adminBypass = $derived(data.adminBypass);
</script>

<svelte:head>
	<title>{OPS_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{OPS_LABELS.fetchedAt(new Date(kpi.fetchedAt).toLocaleString('ja-JP'))}
	</div>

	<!-- KPI カード -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_LABELS.kpiLabelTotal}</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.total}</div>
			<div class="text-xs text-[var(--color-success)] mt-1">{OPS_LABELS.kpiNewThisMonth(stats.newThisMonth)}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_LABELS.kpiLabelActive}</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.active}</div>
			<div class="text-xs text-[var(--color-success)] mt-1">{activeRate}%</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_LABELS.kpiLabelGracePeriod}</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.gracePeriod}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_LABELS.kpiLabelSuspended}</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.suspended}</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">{OPS_LABELS.kpiLabelTerminated}</div>
			<div class="text-[2rem] font-bold text-[var(--color-text)]">{stats.terminated}</div>
		</Card>
	</div>

	<!-- プラン内訳 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_LABELS.planBreakdownTitle}</h2>
		<table class="ops-table">
			<thead>
				<tr>
					<th>{OPS_LABELS.planColPlan}</th>
					<th>{OPS_LABELS.planColTenants}</th>
					<th>{OPS_LABELS.planColMrr}</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>{OPS_LABELS.planMonthly}</td>
					<td>{stats.planBreakdown.monthly}</td>
					<td>¥{(stats.planBreakdown.monthly * 500).toLocaleString()}</td>
				</tr>
				<tr>
					<td>{OPS_LABELS.planYearly}</td>
					<td>{stats.planBreakdown.yearly}</td>
					<td>¥{Math.round(stats.planBreakdown.yearly * 5000 / 12).toLocaleString()}</td>
				</tr>
				<tr>
					<td>{OPS_LABELS.planLifetime}</td>
					<td>{stats.planBreakdown.lifetime}</td>
					<td>-</td>
				</tr>
				<tr>
					<td>{OPS_LABELS.planNone}</td>
					<td>{stats.planBreakdown.noPlan}</td>
					<td>-</td>
				</tr>
				<tr class="total-row">
					<td>{OPS_LABELS.planTotalMrr}</td>
					<td>{stats.active}</td>
					<td>¥{(stats.planBreakdown.monthly * 500 + Math.round(stats.planBreakdown.yearly * 5000 / 12)).toLocaleString()}</td>
				</tr>
			</tbody>
		</table>
	</Card>

	<!-- 価格見直しトリガー (#837) -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">
			{OPS_LABELS.triggerTitle}
			{#if firedTriggers.length > 0}
				<Badge variant="warning" size="sm">{OPS_LABELS.triggerFired(firedTriggers.length)}</Badge>
			{:else if triggerReport.skipped}
				<Badge variant="neutral" size="sm">{OPS_LABELS.triggerSkipped}</Badge>
			{:else}
				<Badge variant="success" size="sm">{OPS_LABELS.triggerNormal}</Badge>
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
									<Badge variant="warning" size="sm">{OPS_LABELS.triggerFiredBadge}</Badge>
								{:else}
									<Badge variant="success" size="sm">{OPS_LABELS.triggerNormal}</Badge>
								{/if}
							</div>
							<div class="text-xs text-[var(--color-text-muted)]">
								{OPS_LABELS.triggerCurrentValue((trigger.value * 100).toFixed(1), (trigger.threshold * 100).toFixed(1), String(trigger.consecutiveMonths), String(trigger.requiredMonths))}
							</div>
							{#if trigger.fired}
								<div class="text-xs text-[var(--color-feedback-warning-text)] mt-1">
									{OPS_LABELS.triggerRecommendation(trigger.recommendation)}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
		<div class="text-xs text-[var(--color-text-muted)] mt-3">
			{OPS_LABELS.triggerEvaluatedAt(new Date(triggerReport.evaluatedAt).toLocaleString('ja-JP'), String(triggerReport.paidUserCount))}
		</div>
	</Card>

	<!-- admin bypass merge メトリクス (#1201 / ADR-0044) -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">
			{OPS_LABELS.bypassTitle}
			{#if adminBypass.available}
				{#if adminBypass.totalEvidenceMissing > 0}
					<Badge variant="warning" size="sm">{OPS_LABELS.bypassEvidenceMissing(adminBypass.totalEvidenceMissing)}</Badge>
				{:else}
					<Badge variant="success" size="sm">{OPS_LABELS.bypassNormal}</Badge>
				{/if}
			{:else}
				<Badge variant="neutral" size="sm">{OPS_LABELS.bypassUnavailable}</Badge>
			{/if}
		</h2>
		{#if !adminBypass.available}
			<p class="text-sm text-[var(--color-text-muted)]">
				{OPS_LABELS.bypassUnavailableReason(adminBypass.reason)}
			</p>
		{:else if adminBypass.monthly.length === 0}
			<p class="text-sm text-[var(--color-text-muted)]">
				{OPS_LABELS.bypassEmpty(adminBypass.lookbackMonths)}
			</p>
		{:else}
			<table class="ops-table">
				<thead>
					<tr>
						<th>{OPS_LABELS.bypassColMonth}</th>
						<th>{OPS_LABELS.bypassColTotal}</th>
						<th>{OPS_LABELS.bypassColBypass}</th>
						<th>{OPS_LABELS.bypassColMissing}</th>
					</tr>
				</thead>
				<tbody>
					{#each adminBypass.monthly as m (m.month)}
						<tr>
							<td>{m.month}</td>
							<td>{m.mergedCount}</td>
							<td>{m.adminBypassCount}</td>
							<td class={m.evidenceMissingCount > 0 ? 'text-[var(--color-feedback-warning-text)]' : ''}>
								{m.evidenceMissingCount}
							</td>
						</tr>
					{/each}
					<tr class="total-row">
						<td>{OPS_LABELS.bypassSummaryTotal}</td>
						<td>-</td>
						<td>{adminBypass.totalAdminBypass}</td>
						<td>{adminBypass.totalEvidenceMissing}</td>
					</tr>
				</tbody>
			</table>
		{/if}
		<div class="text-xs text-[var(--color-text-muted)] mt-3">
			{OPS_LABELS.bypassFetchedAt(new Date(adminBypass.fetchedAt).toLocaleString('ja-JP'))} <a href="https://github.com/Takenori-Kusaka/ganbari-quest/blob/main/docs/decisions/archive/0044-admin-bypass-evidence.md" class="underline">{OPS_LABELS.bypassAdrLink}</a>
		</div>
	</Card>

	<!-- ステータス -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_LABELS.systemTitle}</h2>
		<div class="flex flex-col gap-2">
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-text-secondary)]">{OPS_LABELS.stripeLabel}</span>
				<span class={kpi.stripeEnabled ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-warning)]'}>
					{kpi.stripeEnabled ? OPS_LABELS.stripeEnabled : OPS_LABELS.stripeDisabled}
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

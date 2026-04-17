<script lang="ts">
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const analysis = $derived(data.cohortAnalysis);
const cohorts = $derived(analysis.cohorts);

/** 残存率を % 表示に変換 */
function fmtPct(value: number | null): string {
	if (value === null) return '-';
	return `${(value * 100).toFixed(1)}%`;
}

/** 残存率に基づく色クラス */
function retentionColorClass(value: number | null): string {
	if (value === null) return 'text-[var(--color-text-muted)]';
	if (value >= 0.7) return 'text-[var(--color-feedback-success-text)]';
	if (value >= 0.4) return 'text-[var(--color-feedback-warning-text)]';
	return 'text-[var(--color-feedback-error-text)]';
}
</script>

<svelte:head>
	<title>OPS - コホート分析</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<!-- KPI サマリー -->
	<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">ARPU</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-text)]">
				&yen;{analysis.arpu.toLocaleString()}
			</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">月次解約率</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-text)]">
				{(analysis.monthlyChurnRate * 100).toFixed(1)}%
			</div>
		</Card>
		<Card padding="none" class="p-5 text-center">
			<div class="ops-kpi-label">理論値 LTV</div>
			<div class="text-[1.75rem] font-bold text-[var(--color-text)]">
				&yen;{analysis.theoreticalLtv.toLocaleString()}
			</div>
			<div class="text-xs text-[var(--color-text-muted)] mt-1">ARPU / 月次解約率</div>
		</Card>
	</div>

	<!-- コホート別リテンションカーブ（表形式） -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">
			月次コホート別リテンション（過去{data.monthsBack}ヶ月）
		</h2>
		{#if cohorts.length === 0}
			<p class="text-[var(--color-text-tertiary)] text-sm text-center p-8">
				コホートデータがありません
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="ops-table">
					<thead>
						<tr>
							<th>コホート</th>
							<th class="ops-num">テナント数</th>
							<th class="ops-num">有料</th>
							<th class="ops-num">Day 1</th>
							<th class="ops-num">Day 7</th>
							<th class="ops-num">Day 14</th>
							<th class="ops-num">Day 30</th>
							<th class="ops-num">Day 60</th>
							<th class="ops-num">Day 90</th>
							<th class="ops-num">LTV</th>
						</tr>
					</thead>
					<tbody>
						{#each cohorts as cohort}
							<tr>
								<td>
									{cohort.month}
									{#if cohort.insufficientSample}
										<Badge variant="neutral" size="sm">
											サンプル不足
										</Badge>
									{/if}
								</td>
								<td class="ops-num">{cohort.size}</td>
								<td class="ops-num">{cohort.paidSize}</td>
								<td class="ops-num {retentionColorClass(cohort.retention[1])}">{fmtPct(cohort.retention[1])}</td>
								<td class="ops-num {retentionColorClass(cohort.retention[7])}">{fmtPct(cohort.retention[7])}</td>
								<td class="ops-num {retentionColorClass(cohort.retention[14])}">{fmtPct(cohort.retention[14])}</td>
								<td class="ops-num {retentionColorClass(cohort.retention[30])}">{fmtPct(cohort.retention[30])}</td>
								<td class="ops-num {retentionColorClass(cohort.retention[60])}">{fmtPct(cohort.retention[60])}</td>
								<td class="ops-num {retentionColorClass(cohort.retention[90])}">{fmtPct(cohort.retention[90])}</td>
								<td class="ops-num font-semibold">
									{#if cohort.insufficientSample}
										-
									{:else}
										&yen;{cohort.ltv.toLocaleString()}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	<!-- コホート別 LTV 比較 -->
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">
			コホート別 LTV 比較
		</h2>
		<div class="flex flex-col gap-2">
			{#each cohorts as cohort}
				{@const maxLtv = Math.max(...cohorts.map((c) => c.ltv), 1)}
				{@const barWidth = cohort.ltv > 0 ? (cohort.ltv / maxLtv) * 100 : 0}
				<div class="flex items-center gap-3">
					<span class="text-xs font-mono w-16 shrink-0 text-[var(--color-text-secondary)]">
						{cohort.month}
					</span>
					<div class="flex-1 h-6 rounded bg-[var(--color-surface-muted)] overflow-hidden">
						<div
							class="h-full rounded bg-[var(--color-action-primary)] transition-all"
							style:width="{barWidth}%"
						></div>
					</div>
					<span class="text-xs font-mono w-20 text-right shrink-0 text-[var(--color-text-primary)]">
						{#if cohort.insufficientSample}
							サンプル不足
						{:else}
							&yen;{cohort.ltv.toLocaleString()}
						{/if}
					</span>
				</div>
			{/each}
		</div>
		{#if analysis.theoreticalLtv > 0}
			<div class="mt-4 text-xs text-[var(--color-text-muted)]">
				理論値 LTV (ARPU/月次解約率): &yen;{analysis.theoreticalLtv.toLocaleString()}
			</div>
		{/if}
	</Card>

	<div class="text-xs text-[var(--color-text-muted)] text-right">
		最終取得: {new Date(analysis.fetchedAt).toLocaleString('ja-JP')}
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

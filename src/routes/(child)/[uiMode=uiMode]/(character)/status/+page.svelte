<script lang="ts">
import { APP_LABELS, CHILD_STATUS_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { getModeVariant } from '$lib/features/child-home/variants';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const variant = $derived(getModeVariant((data.uiMode ?? 'preschool') as UiMode));
const t = $derived(variant.text);
const f = $derived(variant.features);

const growthBestCat = $derived.by(() => {
	if (!data.monthlyComparison || CATEGORY_DEFS.length === 0) return CATEGORY_DEFS[0];
	const changes = data.monthlyComparison.changes;
	return CATEGORY_DEFS.reduce((best, c) =>
		(changes[c.id] ?? 0) > (changes[best.id] ?? 0) ? c : best,
	);
});

const growthWeakCat = $derived.by(() => {
	if (!data.status || CATEGORY_DEFS.length === 0) return CATEGORY_DEFS[0];
	const statuses = data.status.statuses;
	return CATEGORY_DEFS.reduce((weak, c) =>
		(statuses[c.id]?.value ?? 0) < (statuses[weak.id]?.value ?? 0) ? c : weak,
	);
});

const radarCategories = $derived(
	data.status
		? CATEGORY_DEFS.map((catDef) => {
				const s = data.status?.statuses[catDef.id];
				return {
					categoryId: catDef.id,
					name: catDef.name,
					value: s?.value ?? 0,
					maxValue: data.status?.maxValue,
					level: s?.level ?? 1,
					deviationScore: s?.deviationScore ?? 50,
					stars: s?.stars ?? 0,
					trend: (s?.trend ?? 'stable') as 'up' | 'down' | 'stable',
				};
			})
		: [],
);
</script>

<svelte:head>
	<title>{PAGE_TITLES.childStatus}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	{#if data.status}
		<Card variant="elevated" padding="md" class="mb-[var(--sp-md)]" data-tutorial="radar-chart">
			{#snippet children()}
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]" data-testid="growth-chart-heading">{CHILD_STATUS_LABELS.growthChartTitle}</h2>
			<div class="flex justify-center">
				<RadarChart
					categories={radarCategories}
					comparisonValues={f.showComparison ? data.monthlyComparison?.previous : undefined}
					size={f.showComparison ? 300 : 280}
				/>
			</div>
			{/snippet}
		</Card>

		{#if f.showComparison && data.monthlyComparison && growthBestCat && growthWeakCat}
			{@const changes = data.monthlyComparison.changes}
			<Card variant="elevated" padding="md" class="mb-[var(--sp-md)]">
				{#snippet children()}
				{#if (changes[growthBestCat.id] ?? 0) > 0}
					<p class="text-sm font-bold">
						{CHILD_STATUS_LABELS.growthBestCatPrefix}{growthBestCat.name}{CHILD_STATUS_LABELS.growthBestCatSuffix}
						{#if (changes[growthBestCat.id] ?? 0) > 5}
							{CHILD_STATUS_LABELS.growthHighMessage}
						{:else}
							{CHILD_STATUS_LABELS.growthLowMessage}
						{/if}
					</p>
				{:else}
					<p class="text-sm font-bold">{CHILD_STATUS_LABELS.growthStableMessage}</p>
				{/if}
				{#if growthWeakCat.id !== growthBestCat.id}
					<p class="text-xs text-[var(--color-text-muted)] mt-1">
						{CHILD_STATUS_LABELS.growthWeakCatPrefix}{growthWeakCat.name}{CHILD_STATUS_LABELS.growthWeakCatSuffix}
					</p>
				{/if}
				{/snippet}
			</Card>
		{/if}

		<Card variant="elevated" padding="md">
			{#snippet children()}
			<div class="flex flex-col gap-[var(--sp-md)]">
				{#each CATEGORY_DEFS as catDef (catDef.id)}
					{@const status = data.status.statuses[catDef.id]}
					{#if status}
						<div>
							<StatusBar
								categoryId={catDef.id}
								value={status.value}
								level={status.level}
								progressPct={status.progressPct}
							/>
							{#if f.showTrends}
								<div class="flex items-center mt-1 px-1">
									<span class="text-xs text-[var(--theme-accent)]">
										{#if status.trend === 'up'}
											{t.statusTrendUp}
										{:else if status.trend === 'down'}
											{t.statusTrendDown}
										{:else}
											{t.statusTrendNeutral}
										{/if}
									</span>
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
			{/snippet}
		</Card>

	{:else}
		<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-sm)]">⭐</span>
			<p class="font-bold">{CHILD_STATUS_LABELS.emptyStatus}</p>
		</div>
	{/if}
</div>

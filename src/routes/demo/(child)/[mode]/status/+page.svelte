<script lang="ts">
import { APP_LABELS, PAGE_TITLES, UI_LABELS } from '$lib/domain/labels';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { getComparisonLabel } from '$lib/domain/validation/status';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const radarCategories = $derived(
	data.status
		? CATEGORY_DEFS.map((catDef) => {
				const s = data.status?.statuses[catDef.id];
				return {
					categoryId: catDef.id,
					name: catDef.name,
					value: s?.value ?? 0,
					maxValue: data.status?.maxValue ?? 0,
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
	<title>{PAGE_TITLES.childStatus}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	{#if data.status}
		<!-- Radar chart -->
		<Card padding="md" class="mb-[var(--sp-md)]">
			{#snippet children()}
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]">{UI_LABELS.status}</h2>
			<div class="flex justify-center">
				<RadarChart categories={radarCategories} size={300} />
			</div>
			{/snippet}
		</Card>

		<!-- Category details (always visible) -->
		<Card padding="md">
			{#snippet children()}
			<div class="flex flex-col gap-[var(--sp-md)]">
				{#each CATEGORY_DEFS as catDef (catDef.id)}
					{@const status = data.status?.statuses[catDef.id]}
					{#if status}
						{@const comparison = getComparisonLabel(status.deviationScore)}
						<div>
							<StatusBar
								categoryId={catDef.id}
								value={status.value}
								level={status.level}
								progressPct={status.progressPct}
							/>
							<div class="flex items-center mt-1 px-1">
								<span class="text-xs text-[var(--theme-accent)]">
									{comparison.emoji} {comparison.text}
								</span>
							</div>
						</div>
					{/if}
				{/each}
			</div>
			{/snippet}
		</Card>
	{:else}
		<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-sm)]">⭐</span>
			<p class="font-bold">{UI_LABELS.noStatus}</p>
		</div>
	{/if}
</div>

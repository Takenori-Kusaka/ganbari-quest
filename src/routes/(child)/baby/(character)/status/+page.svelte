<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
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
	<title>つよさ - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	{#if data.status}
		<!-- Radar chart -->
		<Card variant="elevated" padding="md" class="mb-[var(--sp-md)]" data-tutorial="radar-chart">
			{#snippet children()}
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]">ステータス</h2>
			<div class="flex justify-center">
				<RadarChart categories={radarCategories} size={280} />
			</div>
			{/snippet}
		</Card>

		<!-- Category details (always visible) -->
		<Card variant="elevated" padding="md">
			{#snippet children()}
			<div class="flex flex-col gap-[var(--sp-md)]" data-testid="growth-detail-toggle">
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
						</div>
					{/if}
				{/each}
			</div>
			{/snippet}
		</Card>
	{:else}
		<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-sm)]">⭐</span>
			<p class="font-bold">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

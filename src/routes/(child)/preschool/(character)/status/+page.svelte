<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

// Growth comment helpers
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

// Prepare radar chart data
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
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]" data-testid="growth-chart-heading">せいちょうチャート</h2>
			<div class="flex justify-center">
				<RadarChart
					categories={radarCategories}
					comparisonValues={data.monthlyComparison?.previous}
					size={300}
				/>
			</div>
			{/snippet}
		</Card>

		<!-- Growth comments -->
		{#if data.monthlyComparison && growthBestCat && growthWeakCat}
			{@const changes = data.monthlyComparison.changes}
			<Card variant="elevated" padding="md" class="mb-[var(--sp-md)]">
				{#snippet children()}
				{#if (changes[growthBestCat.id] ?? 0) > 0}
					<p class="text-sm font-bold">
						💬 {growthBestCat.name}が
						{#if (changes[growthBestCat.id] ?? 0) > 5}
							すごくのびたね！
						{:else}
							ちょっとずつ せいちょうしてるよ！
						{/if}
					</p>
				{:else}
					<p class="text-sm font-bold">💬 あんていしてるね！ またがんばろう！</p>
				{/if}
				{#if growthWeakCat.id !== growthBestCat.id}
					<p class="text-xs text-[var(--color-text-muted)] mt-1">
						🌟 {growthWeakCat.name}にチャレンジすると のびしろがたくさん！
					</p>
				{/if}
				{/snippet}
			</Card>
		{/if}

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
							<div class="flex items-center mt-1 px-1">
								<span class="text-xs text-[var(--theme-accent)]">
									{#if status.trend === 'up'}
										🌟 まえよりのびたよ！
									{:else if status.trend === 'down'}
										💪 つぎはもっとがんばろう！
									{:else}
										😊 いいちょうしだよ！
									{/if}
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
			<p class="font-bold">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

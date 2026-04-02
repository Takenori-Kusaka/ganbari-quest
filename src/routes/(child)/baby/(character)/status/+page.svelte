<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

let detailOpen = $state(false);

const trendIcons: Record<string, string> = {
	up: '📈',
	down: '📉',
	stable: '➡️',
};

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

<div class="px-4 py-1">
	{#if data.status}
		<!-- Category levels -->
		<Card variant="elevated" padding="md" class="mb-6">
			{#snippet children()}
			{#if data.activeTitle}
				<div class="flex flex-col items-center gap-1 mb-4">
					<span class="text-sm font-bold text-[var(--color-point)]">
						{data.activeTitle.icon} {data.activeTitle.name}
					</span>
				</div>
			{/if}
			<div class="flex flex-col gap-2">
				{#each CATEGORY_DEFS as catDef (catDef.id)}
					{@const stat = data.status.statuses[catDef.id]}
					{#if stat}
						{@const pct = stat.level >= 99 ? 100 : (stat.progressPct ?? 0)}
						<div class="flex items-center gap-1">
							<span class="text-lg w-7 text-center">{catDef.icon}</span>
							<div class="flex-1 min-w-0">
								<div class="flex items-center justify-between mb-0.5">
									<span class="text-xs font-bold text-[var(--color-text)]">{catDef.name} Lv.{stat.level}</span>
									{#if stat.level < 99}
										<span class="text-[10px] text-[var(--color-text-muted)]">あと {Math.round(stat.expToNextLevel)}XP</span>
									{:else}
										<span class="text-[10px] font-bold text-[var(--color-point)]">MAX</span>
									{/if}
								</div>
								<div class="h-2 bg-gray-100 rounded-full overflow-hidden">
									<div class="h-full rounded-full transition-all bg-[var(--theme-accent)]" style:width="{pct}%"></div>
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
			{/snippet}
		</Card>

		<!-- Radar chart -->
		<Card variant="elevated" padding="md" class="mb-3">
			{#snippet children()}
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">ステータス</h2>
			<div class="flex justify-center">
				<RadarChart categories={radarCategories} size={280} />
			</div>
			{/snippet}
		</Card>

		<!-- Collapsible detail -->
		<Card variant="elevated" padding="none">
			{#snippet children()}
			<button
				class="w-full p-4 flex items-center justify-between text-sm font-bold text-[var(--color-text-muted)] bg-transparent border-none cursor-pointer"
				onclick={() => { soundService.play('tap'); detailOpen = !detailOpen; }}
			>
				<span>{detailOpen ? '▼' : '▶'} くわしくみる</span>
			</button>
			{#if detailOpen}
				<div class="px-4 pb-4 flex flex-col gap-4">
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
								<div class="flex justify-between items-center mt-1 px-1">
									<span class="text-xs text-[var(--color-text-muted)]">
										{trendIcons[status.trend] ?? '➡️'}
									</span>
								</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
			{/snippet}
		</Card>
	{:else}
		<div class="flex flex-col items-center py-12 text-[var(--color-text-muted)]">
			<span class="text-[2.5rem] mb-2">⭐</span>
			<p class="font-bold">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

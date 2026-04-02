<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

let detailOpen = $state(false);

const trendIcons: Record<string, string> = {
	up: '📈',
	down: '📉',
	stable: '➡️',
};

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
		<!-- Category levels -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm mb-[var(--sp-lg)]">
			{#if data.activeTitle}
				<p class="text-xs font-bold mb-[var(--sp-sm)] text-[var(--color-point)]">
					{data.activeTitle.icon} {data.activeTitle.name}
				</p>
			{/if}
			<div class="flex flex-col gap-[var(--sp-sm)]">
				{#each CATEGORY_DEFS as catDef (catDef.id)}
					{@const stat = data.status.statuses[catDef.id]}
					{#if stat}
						{@const pct = stat.level >= 99 ? 100 : (stat.progressPct ?? 0)}
						<div class="flex items-center gap-[var(--sp-xs)]">
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
		</div>

		<!-- Radar chart -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm mb-[var(--sp-md)]">
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]">ステータス</h2>
			<div class="flex justify-center">
				<RadarChart
					categories={radarCategories}
					comparisonValues={data.monthlyComparison?.previous}
					size={300}
				/>
			</div>
		</div>

		<!-- Collapsible detail -->
		<div class="bg-white rounded-[var(--radius-md)] shadow-sm overflow-hidden">
			<button
				class="w-full p-[var(--sp-md)] flex items-center justify-between text-sm font-bold text-[var(--color-text-muted)]"
				onclick={() => { soundService.play('tap'); detailOpen = !detailOpen; }}
			>
				<span>{detailOpen ? '▼' : '▶'} くわしく見る</span>
			</button>
			{#if detailOpen}
				<div class="px-[var(--sp-md)] pb-[var(--sp-md)] flex flex-col gap-[var(--sp-md)]">
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
									<span class="text-xs text-[var(--theme-accent)]">
										{#if status.trend === 'up'}
											🌟 前よりのびたよ！
										{:else if status.trend === 'down'}
											💪 次はもっとがんばろう！
										{:else}
											😊 いい調子だよ！
										{/if}
									</span>
									<span class="text-xs text-[var(--color-text-muted)]">
										{trendIcons[status.trend] ?? '➡️'}
									</span>
								</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

	{:else}
		<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-sm)]">⭐</span>
			<p class="font-bold">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

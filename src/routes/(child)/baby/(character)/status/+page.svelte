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

<div class="status-page">
	{#if data.status}
		<!-- Category levels -->
		<div class="status-level">
			{#if data.activeTitle}
				<div class="status-level__center flex-row gap-2 mb-3">
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
		</div>

		<!-- Radar chart -->
		<div class="status-radar">
			<h2 class="status-radar__title">ステータス</h2>
			<div class="status-radar__chart">
				<RadarChart categories={radarCategories} size={280} />
			</div>
		</div>

		<!-- Collapsible detail -->
		<div class="status-detail">
			<button
				class="status-detail__toggle"
				onclick={() => { soundService.play('tap'); detailOpen = !detailOpen; }}
			>
				<span>{detailOpen ? '▼' : '▶'} くわしくみる</span>
			</button>
			{#if detailOpen}
				<div class="status-detail__content">
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
								<div class="status-bars__trend">
									<span class="status-bars__trend-icon">
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
		<div class="status-empty">
			<span class="status-empty__icon">⭐</span>
			<p class="status-empty__text">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

<style>
	.status-page {
		padding: 4px 16px;
	}

	.status-level {
		background: white;
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		margin-bottom: 24px;
	}

	.status-level__center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin-bottom: 16px;
	}

	.status-level__title { font-size: 0.875rem; font-weight: 700; color: var(--theme-accent); }

	.status-radar {
		background: white;
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		margin-bottom: 12px;
	}

	.status-radar__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-bottom: 8px;
	}

	.status-radar__chart {
		display: flex;
		justify-content: center;
	}

	.status-detail {
		background: white;
		border-radius: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}

	.status-detail__toggle {
		width: 100%;
		padding: 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-muted);
		background: none;
		border: none;
		cursor: pointer;
	}

	.status-detail__content {
		padding: 0 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.status-bars__trend {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 4px;
		padding: 0 4px;
	}

	.status-bars__trend-icon {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

.status-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 0;
		color: var(--color-text-muted);
	}

	.status-empty__icon { font-size: 2.5rem; margin-bottom: 8px; }
	.status-empty__text { font-weight: 700; }
</style>

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
				<div class="status-level__center" style="flex-direction: row; gap: 8px; margin-bottom: 12px;">
					<span style="font-size: 0.875rem; font-weight: 700; color: var(--color-point);">
						{data.activeTitle.icon} {data.activeTitle.name}
					</span>
				</div>
			{/if}
			<div style="display: flex; flex-direction: column; gap: 8px;">
				{#each CATEGORY_DEFS as catDef (catDef.id)}
					{@const stat = data.status.statuses[catDef.id]}
					{#if stat}
						{@const pct = stat.level >= 99 ? 100 : (stat.progressPct ?? 0)}
						<div style="display: flex; align-items: center; gap: 4px;">
							<span style="font-size: 1.125rem; width: 1.75rem; text-align: center;">{catDef.icon}</span>
							<div style="flex: 1; min-width: 0;">
								<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
									<span style="font-size: 0.75rem; font-weight: 700; color: var(--color-text);">{catDef.name} Lv.{stat.level}</span>
									{#if stat.level < 99}
										<span style="font-size: 10px; color: var(--color-text-muted);">あと {Math.round(stat.expToNextLevel)}XP</span>
									{:else}
										<span style="font-size: 10px; font-weight: 700; color: var(--color-point);">MAX</span>
									{/if}
								</div>
								<div style="height: 0.5rem; background: #f3f4f6; border-radius: 9999px; overflow: hidden;">
									<div style="height: 100%; border-radius: 9999px; transition: all; width: {pct}%; background: var(--theme-accent);"></div>
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
		<!-- Achievements link -->
		<a
			href="/baby/achievements"
			class="status-link"
			style="margin-top: 16px;"
		>
			<span style="font-size: 1.5rem;">🏆</span>
			<p class="status-link__title">じっせき</p>
			<p class="status-link__desc">できたことをみよう！</p>
		</a>

		<!-- History link -->
		<a
			href="/baby/history"
			class="status-link"
		>
			<span style="font-size: 1.5rem;">📊</span>
			<p class="status-link__title">きろく</p>
			<p class="status-link__desc">がんばったことをみよう！</p>
		</a>
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

	.status-link {
		display: block;
		background: white;
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		text-align: center;
		text-decoration: none;
		color: inherit;
		margin-top: 8px;
	}

	.status-link__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--theme-accent);
		margin-top: 4px;
	}

	.status-link__desc {
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

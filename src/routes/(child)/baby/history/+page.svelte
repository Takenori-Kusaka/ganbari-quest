<script lang="ts">
import { goto } from '$app/navigation';
import Tabs from '$lib/ui/primitives/Tabs.svelte';

import { getCategoryById } from '$lib/domain/validation/activity';

let { data } = $props();

const tabItems = [
	{ value: 'today', label: 'きょう' },
	{ value: 'week', label: 'しゅう' },
	{ value: 'month', label: 'つき' },
];

function handleTabChange(details: { value: string }) {
	goto(`?period=${details.value}`, { replaceState: true, keepFocus: true });
}

// Group logs by date
const logsByDate = $derived(() => {
	const groups: Record<string, typeof data.logs> = {};
	for (const log of data.logs) {
		const date = log.recordedAt.slice(0, 10);
		if (!groups[date]) groups[date] = [];
		groups[date]?.push(log);
	}
	return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
});

function formatDate(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	const month = d.getMonth() + 1;
	const day = d.getDate();
	const weekdays = ['にち', 'げつ', 'か', 'すい', 'もく', 'きん', 'ど'];
	const weekday = weekdays[d.getDay()];
	return `${month}がつ${day}にち（${weekday}）`;
}


</script>

<svelte:head>
	<title>きろく - がんばりクエスト</title>
</svelte:head>

<div class="history-page">
	<Tabs items={tabItems} value={data.period} onValueChange={handleTabChange}>
		{#snippet children(_value)}
			<!-- Summary -->
			<div class="history-summary">
				<div class="history-summary__row">
					<span class="history-summary__label">ごうけい</span>
					<span class="history-summary__value">{data.summary.totalCount}かい</span>
				</div>
				<div class="history-summary__row">
					<span class="history-summary__label">ポイント</span>
					<span class="history-summary__value history-summary__value--point">{data.summary.totalPoints}P</span>
				</div>
				{#if Object.keys(data.summary.byCategory).length > 0}
					<div class="history-summary__cats">
						{#each Object.entries(data.summary.byCategory) as [cat, info]}
							<span
								class="history-summary__cat-badge"
								style="background-color: {getCategoryById(Number(cat))?.color ?? 'var(--theme-primary)'};"
							>
								{getCategoryById(Number(cat))?.name ?? cat} {info.count}かい
							</span>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Log list -->
			{#if data.logs.length === 0}
				<div class="history-empty">
					<span class="history-empty__icon">📝</span>
					<p class="history-empty__text">まだきろくがないよ</p>
				</div>
			{:else}
				{#each logsByDate() as [date, logs] (date)}
					<div class="history-date-group">
						<h3 class="history-date-group__title">
							{formatDate(date)}
						</h3>
						<div class="history-log-list">
							{#each logs as log (log.id)}
								<div class="history-log">
									<span class="history-log__icon">{log.activityIcon}</span>
									<div class="history-log__body">
										<p class="history-log__name">{log.activityName}</p>
										<p class="history-log__cat">
											<span
												class="history-log__cat-dot"
												style="background-color: {getCategoryById(log.categoryId)?.color ?? 'var(--theme-primary)'};"
											></span>
											{getCategoryById(log.categoryId)?.name ?? ""}
										</p>
									</div>
									<div class="history-log__points">
										<p class="history-log__points-value">+{log.points + log.streakBonus}P</p>
										{#if log.streakDays >= 2}
											<p class="history-log__streak">{log.streakDays}にちれんぞく</p>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		{/snippet}
	</Tabs>
</div>

<style>
	.history-page {
		padding: 4px 16px;
	}

	/* Summary card */
	.history-summary {
		background: white;
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		margin-bottom: 16px;
	}

	.history-summary__row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.history-summary__label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.history-summary__value {
		font-weight: 700;
		font-size: 1.125rem;
	}

	.history-summary__value--point {
		color: var(--color-point);
	}

	.history-summary__cats {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 8px;
	}

	.history-summary__cat-badge {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 9999px;
		color: white;
		font-weight: 700;
	}

	/* Empty state */
	.history-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 0;
		color: var(--color-text-muted);
	}

	.history-empty__icon {
		font-size: 2.5rem;
		margin-bottom: 8px;
	}

	.history-empty__text {
		font-weight: 700;
	}

	/* Date group */
	.history-date-group {
		margin-bottom: 16px;
	}

	.history-date-group__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}

	/* Log item */
	.history-log-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.history-log {
		display: flex;
		align-items: center;
		gap: 8px;
		background: white;
		border-radius: 8px;
		padding: 6px 8px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.history-log__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.history-log__body {
		flex: 1;
		min-width: 0;
	}

	.history-log__name {
		font-size: 0.875rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-log__cat {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.history-log__cat-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.history-log__points {
		text-align: right;
		flex-shrink: 0;
	}

	.history-log__points-value {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-point);
	}

	.history-log__streak {
		font-size: 0.75rem;
		color: var(--theme-accent);
	}
</style>

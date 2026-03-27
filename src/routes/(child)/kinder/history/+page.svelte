<script lang="ts">
import { goto } from '$app/navigation';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import Tabs from '$lib/ui/primitives/Tabs.svelte';
import { soundService } from '$lib/ui/sound';

import { getCategoryById } from '$lib/domain/validation/activity';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

const tabItems = [
	{ value: 'today', label: 'きょう' },
	{ value: 'week', label: 'しゅう' },
	{ value: 'month', label: 'つき' },
];

function handleTabChange(details: { value: string }) {
	soundService.play('tap');
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

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<Tabs items={tabItems} value={data.period} onValueChange={handleTabChange}>
		{#snippet children(_value)}
			<!-- Summary -->
			<div class="bg-white rounded-[var(--radius-md)] p-[var(--spacing-md)] shadow-sm mb-[var(--spacing-md)]">
				<div class="flex justify-between items-center mb-[var(--spacing-sm)]">
					<span class="text-sm text-[var(--color-text-muted)]">ごうけい</span>
					<span class="font-bold text-lg">{data.summary.totalCount}かい</span>
				</div>
				<div class="flex justify-between items-center">
					<span class="text-sm text-[var(--color-text-muted)]">ポイント</span>
					<span class="font-bold text-lg text-[var(--color-point)]">{fmtBal(data.summary.totalPoints)}</span>
				</div>
				{#if Object.keys(data.summary.byCategory).length > 0}
					<div class="flex flex-wrap gap-[var(--spacing-xs)] mt-[var(--spacing-sm)]">
						{#each Object.entries(data.summary.byCategory) as [cat, info]}
							<span
								class="text-xs px-2 py-1 rounded-[var(--radius-full)] text-white font-bold"
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
				<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
					<span class="text-4xl mb-[var(--spacing-sm)]">📝</span>
					<p class="font-bold">まだきろくがないよ</p>
				</div>
			{:else}
				{#each logsByDate() as [date, logs] (date)}
					<div class="mb-[var(--spacing-md)]">
						<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--spacing-xs)]">
							{formatDate(date)}
						</h3>
						<div class="flex flex-col gap-[var(--spacing-xs)]">
							{#each logs as log (log.id)}
								<div class="flex items-center gap-[var(--spacing-sm)] bg-white rounded-[var(--radius-sm)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] shadow-sm">
									<span class="text-2xl">{log.activityIcon}</span>
									<div class="flex-1 min-w-0">
										<p class="text-sm font-bold truncate">{log.activityName}</p>
										<p class="text-xs text-[var(--color-text-muted)]">
											<span
												class="inline-block w-2 h-2 rounded-[var(--radius-full)] mr-1"
												style="background-color: {getCategoryById(log.categoryId)?.color ?? 'var(--theme-primary)'};"
											></span>
											{getCategoryById(log.categoryId)?.name ?? ""}
										</p>
									</div>
									<div class="text-right shrink-0">
										<p class="text-sm font-bold text-[var(--color-point)]">{fmtPts(log.points + log.streakBonus)}</p>
										{#if log.streakDays >= 2}
											<p class="text-xs text-[var(--theme-accent)]">{log.streakDays}にちれんぞく</p>
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

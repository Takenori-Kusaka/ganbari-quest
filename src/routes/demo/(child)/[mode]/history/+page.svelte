<script lang="ts">
import { formatPointValueWithSign } from '$lib/domain/point-display';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

// Group logs by date
const groupedLogs = $derived(() => {
	const groups = new Map<string, typeof data.logs>();
	for (const log of data.logs) {
		const date = log.recordedDate;
		if (!groups.has(date)) groups.set(date, []);
		groups.get(date)!.push(log);
	}
	return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
});

function formatDate(dateStr: string): string {
	const d = new Date(dateStr);
	const month = d.getMonth() + 1;
	const day = d.getDate();
	const weekdays = ['にち', 'げつ', 'か', 'すい', 'もく', 'きん', 'ど'];
	const weekday = weekdays[d.getDay()];
	return `${month}がつ${day}にち（${weekday}）`;
}
</script>

<svelte:head>
	<title>きろく - がんばりクエスト デモ</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<h2 class="text-lg font-bold mb-[var(--spacing-md)]">きろく</h2>

	{#if data.logs.length === 0}
		<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-sm)]">📋</span>
			<p class="font-bold">きろくがまだないよ</p>
		</div>
	{:else}
		{#each groupedLogs() as [date, logs] (date)}
			<div class="mb-[var(--spacing-md)]">
				<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--spacing-xs)]">
					{formatDate(date)}
				</h3>
				<div class="flex flex-col gap-1">
					{#each logs as log (log.id)}
						<div class="flex items-center gap-[var(--spacing-sm)] py-2 px-[var(--spacing-sm)] bg-white rounded-[var(--radius-md)] shadow-sm">
							<span class="text-2xl">{log.activityIcon}</span>
							<div class="flex-1 min-w-0">
								<p class="font-bold text-sm truncate">{log.activityName}</p>
								<p class="text-xs text-[var(--color-text-muted)]">{log.categoryName}</p>
							</div>
							<div class="text-right">
								<p class="font-bold text-sm text-[var(--color-point)]">{fmtPts(log.points)}</p>
								{#if log.streakDays > 1}
									<p class="text-xs text-[var(--color-text-muted)]">{log.streakDays}日れんぞく</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>

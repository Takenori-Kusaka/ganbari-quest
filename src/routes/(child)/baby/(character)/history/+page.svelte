<script lang="ts">
import { goto } from '$app/navigation';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import Card from '$lib/ui/primitives/Card.svelte';
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

<div class="py-1 px-4">
	<Tabs items={tabItems} value={data.period} onValueChange={handleTabChange}>
		{#snippet children(_value)}
			<!-- Summary -->
			<Card variant="elevated" padding="md" class="mb-4">
				{#snippet children()}
				<div class="flex justify-between items-center mb-1">
					<span class="text-sm text-[var(--color-text-muted)]">ごうけい</span>
					<span class="font-bold text-lg">{data.summary.totalCount}かい</span>
				</div>
				<div class="flex justify-between items-center mb-1">
					<span class="text-sm text-[var(--color-text-muted)]">ポイント</span>
					<span class="font-bold text-lg text-[var(--color-point)]">{fmtBal(data.summary.totalPoints)}</span>
				</div>
				{#if Object.keys(data.summary.byCategory).length > 0}
					<div class="flex flex-wrap gap-1 mt-2">
						{#each Object.entries(data.summary.byCategory) as [cat, info]}
							<span
								class="text-xs px-2 py-0.5 rounded-full text-white font-bold"
								style:background-color={getCategoryById(Number(cat))?.color ?? 'var(--theme-primary)'}
							>
								{getCategoryById(Number(cat))?.name ?? cat} {info.count}かい
							</span>
						{/each}
					</div>
				{/if}
				{/snippet}
			</Card>

			<!-- Log list -->
			{#if data.logs.length === 0}
				<div class="flex flex-col items-center py-12 text-[var(--color-text-muted)]">
					<span class="text-[2.5rem] mb-2">📝</span>
					<p class="font-bold">まだきろくがないよ</p>
				</div>
			{:else}
				{#each logsByDate() as [date, logs] (date)}
					<div class="mb-4">
						<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-1">
							{formatDate(date)}
						</h3>
						<div class="flex flex-col gap-1">
							{#each logs as log (log.id)}
								<div class="history-log flex items-center gap-2 bg-white rounded-lg px-2 py-1.5">
									<span class="text-2xl shrink-0">{log.activityIcon}</span>
									<div class="flex-1 min-w-0">
										<p class="text-sm font-bold overflow-hidden text-ellipsis whitespace-nowrap">{log.activityName}</p>
										<p class="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
											<span
												class="inline-block w-2 h-2 rounded-full"
												style:background-color={getCategoryById(log.categoryId)?.color ?? 'var(--theme-primary)'}
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

<style>
	.history-log {
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}
</style>

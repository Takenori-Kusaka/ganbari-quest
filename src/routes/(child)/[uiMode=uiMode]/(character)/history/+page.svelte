<script lang="ts">
import { goto } from '$app/navigation';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import { getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { getModeVariant } from '$lib/features/child-home/variants';
import Card from '$lib/ui/primitives/Card.svelte';
import Tabs from '$lib/ui/primitives/Tabs.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

const t = $derived(getModeVariant((data.uiMode ?? 'preschool') as UiMode).text);

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

const tabItems = $derived([
	{ value: 'today', label: t.historyTabToday },
	{ value: 'week', label: t.historyTabWeek },
	{ value: 'month', label: t.historyTabMonth },
]);

function handleTabChange(details: { value: string }) {
	soundService.play('tap');
	goto(`?period=${details.value}`, { replaceState: true, keepFocus: true });
}

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
	const weekday = t.weekdays[d.getDay()];
	return `${month}${t.historyCountUnit === 'かい' ? 'がつ' : '月'}${day}${t.historyCountUnit === 'かい' ? 'にち' : '日'}（${weekday}）`;
}
</script>

<svelte:head>
	<title>{t.historyTitle} - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	<Tabs items={tabItems} value={data.period} onValueChange={handleTabChange}>
		{#snippet children(_value)}
			<Card variant="elevated" padding="md" class="mb-[var(--sp-md)]">
				{#snippet children()}
				<div class="flex justify-between items-center mb-[var(--sp-sm)]">
					<span class="text-sm text-[var(--color-text-muted)]">{t.historyTotalLabel}</span>
					<span class="font-bold text-lg">{data.summary.totalCount}{t.historyCountUnit}</span>
				</div>
				<div class="flex justify-between items-center">
					<span class="text-sm text-[var(--color-text-muted)]">ポイント</span>
					<span class="font-bold text-lg text-[var(--color-point)]">{fmtBal(data.summary.totalPoints)}</span>
				</div>
				{#if Object.keys(data.summary.byCategory).length > 0}
					<div class="flex flex-wrap gap-[var(--sp-xs)] mt-[var(--sp-sm)]">
						{#each Object.entries(data.summary.byCategory) as [cat, info]}
							<span
								class="text-xs px-2 py-1 rounded-[var(--radius-full)] text-white font-bold"
								style:background-color={getCategoryById(Number(cat))?.color ?? 'var(--theme-primary)'}
							>
								{getCategoryById(Number(cat))?.name ?? cat} {info.count}{t.historyCountUnit}
							</span>
						{/each}
					</div>
				{/if}
				{/snippet}
			</Card>

			{#if data.logs.length === 0}
				<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
					<span class="text-4xl mb-[var(--sp-sm)]">📝</span>
					<p class="font-bold">{t.historyEmpty}</p>
				</div>
			{:else}
				{#each logsByDate() as [date, logs] (date)}
					<div class="mb-[var(--sp-md)]">
						<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-xs)]">
							{formatDate(date)}
						</h3>
						<div class="flex flex-col gap-[var(--sp-xs)]">
							{#each logs as log (log.id)}
								<div class="flex items-center gap-[var(--sp-sm)] bg-white rounded-[var(--radius-sm)] px-[var(--sp-sm)] py-[var(--sp-xs)] shadow-sm">
									<span class="text-2xl">{log.activityIcon}</span>
									<div class="flex-1 min-w-0">
										<p class="text-sm font-bold truncate">{log.activityName}</p>
										<p class="text-xs text-[var(--color-text-muted)]">
											<span
												class="inline-block w-2 h-2 rounded-[var(--radius-full)] mr-1"
												style:background-color={getCategoryById(log.categoryId)?.color ?? 'var(--theme-primary)'}
											></span>
											{getCategoryById(log.categoryId)?.name ?? ""}
										</p>
									</div>
									<div class="text-right shrink-0">
										<p class="text-sm font-bold text-[var(--color-point)]">{fmtPts(log.points + log.streakBonus)}</p>
										{#if log.streakDays >= 2}
											<p class="text-xs text-[var(--theme-accent)]">{log.streakDays}{t.historyStreakSuffix}</p>
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

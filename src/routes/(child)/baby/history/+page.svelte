<script lang="ts">
let { data } = $props();

function formatDateShort(dateStr: string): string {
	const d = new Date(dateStr);
	return `${d.getMonth() + 1}/${d.getDate()}`;
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
</script>

<svelte:head>
	<title>きろく - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	{#if data.logs.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--spacing-2xl)]">
			<span class="text-6xl">📋</span>
		</div>
	{:else}
		{#each logsByDate() as [date, logs] (date)}
			<div class="mb-[var(--spacing-lg)]">
				<p class="text-center text-sm font-bold text-[var(--color-text-muted)] mb-[var(--spacing-sm)]">
					{formatDateShort(date)}
				</p>
				<div class="flex flex-wrap gap-[var(--spacing-sm)] justify-center">
					{#each logs as log (log.id)}
						<div
							class="w-16 h-16 rounded-[var(--age-border-radius)] bg-white shadow-sm
								flex items-center justify-center"
						>
							<span class="text-3xl">{log.activityIcon}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>

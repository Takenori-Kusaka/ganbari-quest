<script lang="ts">
import { CATEGORIES } from '$lib/domain/validation/activity';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Progress from '$lib/ui/primitives/Progress.svelte';

let { data } = $props();

const characterEmojis: Record<string, string> = {
	hero: '🦸',
	normal: '😊',
	ganbari: '💪',
};

const characterLabels: Record<string, string> = {
	hero: 'ヒーロータイプ',
	normal: 'ふつうタイプ',
	ganbari: 'がんばりタイプ',
};

const trendIcons: Record<string, string> = {
	up: '📈',
	down: '📉',
	stable: '➡️',
};

// Calculate exp bar values from status data
const expBarValue = $derived(() => {
	if (!data.status) return 0;
	const level = data.status.level;
	if (level >= 10) return 100;
	// Current progress within level: (avgStatus - levelMinAvg) / 10 * 100
	const totalExp = Object.values(data.status.statuses).reduce((sum, s) => sum + s.value, 0);
	const avgStatus = totalExp / CATEGORIES.length;
	const levelMinAvg = (level - 1) * 10;
	return Math.min(100, Math.max(0, ((avgStatus - levelMinAvg) / 10) * 100));
});
</script>

<svelte:head>
	<title>つよさ - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	{#if data.status}
		<!-- Character type -->
		<div class="flex flex-col items-center gap-[var(--spacing-sm)] mb-[var(--spacing-lg)]">
			<span class="text-6xl">
				{characterEmojis[data.status.characterType] ?? '😊'}
			</span>
			<p class="text-sm font-bold text-[var(--color-text-muted)]">
				{characterLabels[data.status.characterType] ?? 'ふつうタイプ'}
			</p>
		</div>

		<!-- Level & exp -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--spacing-md)] shadow-sm mb-[var(--spacing-lg)]">
			<div class="flex justify-between items-center mb-[var(--spacing-sm)]">
				<div>
					<span class="text-2xl font-bold">Lv.{data.status.level}</span>
					<span class="text-sm text-[var(--color-text-muted)] ml-[var(--spacing-xs)]">
						{data.status.levelTitle}
					</span>
				</div>
			</div>
			<div class="mb-1">
				<Progress value={expBarValue()} max={100} color="var(--color-point)" size="md" />
			</div>
			{#if data.status.level < 10}
				<p class="text-xs text-[var(--color-text-muted)] text-right">
					つぎのレベルまで あと {data.status.expToNextLevel}
				</p>
			{:else}
				<p class="text-xs text-[var(--color-point)] text-right font-bold">
					さいこうレベル！
				</p>
			{/if}
		</div>

		<!-- Status bars -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--spacing-md)] shadow-sm">
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--spacing-md)]">ステータス</h2>
			<div class="flex flex-col gap-[var(--spacing-md)]">
				{#each CATEGORIES as cat (cat)}
					{@const status = data.status.statuses[cat]}
					{#if status}
						<div>
							<StatusBar
								category={cat}
								value={status.value}
								stars={status.stars}
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
		</div>
	{:else}
		<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-sm)]">⭐</span>
			<p class="font-bold">ステータスがまだないよ</p>
		</div>
	{/if}
</div>

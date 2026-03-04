<script lang="ts">
import { CATEGORIES } from '$lib/domain/validation/activity';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Progress from '$lib/ui/primitives/Progress.svelte';

let { data } = $props();

/** レベル別アイコン */
const levelEmojis: Record<number, string> = {
	1: '🌱', 2: '💪', 3: '⚡', 4: '🔥', 5: '⭐',
	6: '🗡️', 7: '🏆', 8: '✨', 9: '👑', 10: '🌟',
};

/** レベル別はげましメッセージ */
const levelMessages: Record<number, string> = {
	1: 'まだまだこれから！どんどんつよくなろう！',
	2: 'がんばってるね！このちょうしでいこう！',
	3: 'わくわくしてきた！どんどんいこう！',
	4: 'つよくなってきた！もっといけるよ！',
	5: 'すごい！ヒーローになったよ！',
	6: 'とてもすごい！ぼうけんのたつじんだ！',
	7: 'チャンピオンだ！みんなのあこがれだよ！',
	8: 'きせきをおこしているよ！すばらしい！',
	9: 'せかいいちつよい！でんせつだ！',
	10: 'かみさまレベル！これいじょうはない！',
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
	const maxValue = data.status.maxValue;
	const totalExp = Object.values(data.status.statuses).reduce((sum, s) => sum + s.value, 0);
	const avgStatus = totalExp / CATEGORIES.length;
	// 年齢別max値で正規化してからレベル内の進捗を計算
	const normalizedAvg = maxValue > 0 ? (avgStatus / maxValue) * 100 : 0;
	const levelMinAvg = (level - 1) * 10;
	return Math.min(100, Math.max(0, ((normalizedAvg - levelMinAvg) / 10) * 100));
});
</script>

<svelte:head>
	<title>つよさ - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	{#if data.status}
		<!-- Level + title (unified) -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--spacing-md)] shadow-sm mb-[var(--spacing-lg)]">
			<div class="flex flex-col items-center gap-[var(--spacing-xs)] mb-[var(--spacing-md)]">
				<span class="text-5xl">
					{levelEmojis[data.status.level] ?? '⭐'}
				</span>
				<p class="text-2xl font-bold">Lv.{data.status.level}</p>
				<p class="text-sm font-bold" style="color: var(--theme-accent);">
					{data.status.levelTitle}
				</p>
				<p class="text-xs" style="color: var(--color-text-muted); text-align: center;">
					{levelMessages[data.status.level] ?? ''}
				</p>
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
								maxValue={data.status.maxValue}
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

<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import RadarChart from '$lib/ui/components/RadarChart.svelte';
import StatusBar from '$lib/ui/components/StatusBar.svelte';
import Progress from '$lib/ui/primitives/Progress.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

let detailOpen = $state(false);

/** Level icons */
const levelEmojis: Record<number, string> = {
	1: '🌱',
	2: '💪',
	3: '⚡',
	4: '🔥',
	5: '⭐',
	6: '🗡️',
	7: '🏆',
	8: '✨',
	9: '👑',
	10: '🌟',
};

/** Level messages (adult/neutral tone) */
const levelMessages: Record<number, string> = {
	1: 'スタート地点。ここから積み上げていこう',
	2: '成長の兆しが見える。継続が大事',
	3: '実力が身についてきた',
	4: '着実な成長。この調子で',
	5: '平均を超える実力',
	6: '上位レベルに到達',
	7: 'トップクラスの実力',
	8: '卓越した成果',
	9: '最高峰の領域',
	10: '到達可能な最高レベル',
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
	const avgStatus = totalExp / CATEGORY_DEFS.length;
	const normalizedAvg = maxValue > 0 ? (avgStatus / maxValue) * 100 : 0;
	const levelMinAvg = (level - 1) * 10;
	return Math.min(100, Math.max(0, ((normalizedAvg - levelMinAvg) / 10) * 100));
});

// Prepare radar chart data
const radarCategories = $derived(
	data.status
		? CATEGORY_DEFS.map((catDef) => {
				const s = data.status?.statuses[catDef.id];
				return {
					categoryId: catDef.id,
					name: catDef.name,
					value: s?.value ?? 0,
					maxValue: data.status?.maxValue,
					deviationScore: s?.deviationScore ?? 50,
					stars: s?.stars ?? 0,
					trend: (s?.trend ?? 'stable') as 'up' | 'down' | 'stable',
				};
			})
		: [],
);
</script>

<svelte:head>
	<title>実績 - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	{#if data.status}
		<!-- Level + title -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm mb-[var(--sp-lg)]">
			<div class="flex flex-col items-center gap-[var(--sp-xs)] mb-[var(--sp-md)]">
				<span class="text-5xl">
					{levelEmojis[data.status.level] ?? '⭐'}
				</span>
				<p class="text-2xl font-bold">Lv.{data.status.level}</p>
				<p class="text-sm font-bold" style="color: var(--theme-accent);">
					{data.status.levelTitle}
				</p>
				{#if data.activeTitle}
					<p class="text-xs font-bold" style="color: var(--color-point);">
						{data.activeTitle.icon} {data.activeTitle.name}
					</p>
				{/if}
				<p class="text-xs" style="color: var(--color-text-muted); text-align: center;">
					{levelMessages[data.status.level] ?? ''}
				</p>
			</div>
			<div class="mb-1">
				<Progress value={expBarValue()} max={100} color="var(--color-point)" size="md" />
			</div>
			{#if data.status.level < 10}
				<p class="text-xs text-[var(--color-text-muted)] text-right">
					次のレベルまで {data.status.expToNextLevel}
				</p>
			{:else}
				<p class="text-xs text-[var(--color-point)] text-right font-bold">
					最高レベル
				</p>
			{/if}
		</div>

		<!-- Radar chart -->
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm mb-[var(--sp-md)]">
			<h2 class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-sm)]">ステータス</h2>
			<div class="flex justify-center">
				<RadarChart categories={radarCategories} size={300} />
			</div>
		</div>

		<!-- Collapsible detail -->
		<div class="bg-white rounded-[var(--radius-md)] shadow-sm overflow-hidden">
			<button
				class="w-full p-[var(--sp-md)] flex items-center justify-between text-sm font-bold text-[var(--color-text-muted)]"
				onclick={() => { soundService.play('tap'); detailOpen = !detailOpen; }}
			>
				<span>{detailOpen ? '▼' : '▶'} 詳細</span>
			</button>
			{#if detailOpen}
				<div class="px-[var(--sp-md)] pb-[var(--sp-md)] flex flex-col gap-[var(--sp-md)]">
					{#each CATEGORY_DEFS as catDef (catDef.id)}
						{@const status = data.status.statuses[catDef.id]}
						{#if status}
							<div>
								<StatusBar
									categoryId={catDef.id}
									value={status.value}
									maxValue={data.status.maxValue}
								/>
								<div class="flex justify-between items-center mt-1 px-1">
									<span class="text-xs" style="color: var(--theme-accent);">
										{#if status.trend === 'up'}
											📈 上昇傾向
										{:else if status.trend === 'down'}
											📉 下降傾向
										{:else}
											➡️ 安定
										{/if}
									</span>
									<span class="text-xs text-[var(--color-text-muted)]">
										{trendIcons[status.trend] ?? '➡️'}
									</span>
								</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

		<!-- Title collection link -->
		<a
			href="/teen/titles"
			class="mt-[var(--sp-md)] block bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm text-center"
		>
			<span class="text-2xl">🏅</span>
			<p class="text-sm font-bold mt-1" style="color: var(--theme-accent);">称号</p>
			<p class="text-xs text-[var(--color-text-muted)]">獲得した称号一覧</p>
		</a>

		<!-- Shop link -->
		<a
			href="/teen/shop"
			class="mt-[var(--sp-sm)] block bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm text-center"
		>
			<span class="text-2xl">🛒</span>
			<p class="text-sm font-bold mt-1" style="color: var(--theme-accent);">ショップ</p>
			<p class="text-xs text-[var(--color-text-muted)]">カスタマイズ</p>
		</a>

		<!-- Memories link -->
		<a
			href="/teen/memories"
			class="mt-[var(--sp-sm)] block bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm text-center"
		>
			<span class="text-2xl">📖</span>
			<p class="text-sm font-bold mt-1" style="color: var(--theme-accent);">振り返り</p>
			<p class="text-xs text-[var(--color-text-muted)]">誕生日の振り返り</p>
		</a>

		<!-- Career plan link -->
		<a
			href="/teen/career"
			class="mt-[var(--sp-sm)] block bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm text-center"
		>
			<span class="text-2xl">🌟</span>
			<p class="text-sm font-bold mt-1" style="color: var(--theme-accent);">目標</p>
			<p class="text-xs text-[var(--color-text-muted)]">目標設定・キャリアプラン</p>
		</a>
	{:else}
		<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-sm)]">⭐</span>
			<p class="font-bold">データなし</p>
		</div>
	{/if}
</div>

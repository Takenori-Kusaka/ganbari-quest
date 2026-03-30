<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';

let { data } = $props();

const initialChildId = data.children[0]?.id ?? 0;
let selectedChildId = $state(initialChildId);

const selectedChild = $derived(data.children.find((c: { id: number }) => c.id === selectedChildId));
</script>

<svelte:head>
	<title>実績管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- 子供選択 -->
	{#if data.children.length > 0}
		<div class="flex gap-2 mb-6 overflow-x-auto pb-2">
			{#each data.children as child (child.id)}
				<button
					type="button"
					class="px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors
						{selectedChildId === child.id
						? 'bg-blue-500 text-white'
						: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}"
					onclick={() => { selectedChildId = child.id; }}
				>
					{child.nickname}
					<span class="text-xs opacity-75">({child.unlockedCount}/{child.totalCount})</span>
				</button>
			{/each}
		</div>

		{#if selectedChild}
			<!-- ライフイベント付与 -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
				<h3 class="text-lg font-bold text-gray-700 mb-3">🎓 ライフイベント付与</h3>
				<p class="text-sm text-gray-500 mb-3">
					保育園卒園・小学校卒業などの節目を記録し、ボーナスポイントを付与します。
				</p>

				<div class="flex flex-col gap-2">
					{#each data.lifeEvents as event (event.id)}
						<div
							class="flex items-center justify-between p-3 rounded-lg border bg-gray-50 border-gray-200"
						>
							<div class="flex items-center gap-3">
								<span class="text-2xl">{event.icon}</span>
								<div>
									<p class="font-bold text-gray-700">{event.name}</p>
									<p class="text-xs text-gray-500">+{event.bonusPoints}P</p>
								</div>
							</div>
							<button
								disabled
								class="px-3 py-1.5 bg-gray-200 text-gray-400 text-sm font-bold rounded-lg cursor-not-allowed"
							>
								付与する
							</button>
						</div>
					{/each}
				</div>
			</div>

			<!-- 実績一覧 -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
				<h3 class="text-lg font-bold text-gray-700 mb-3">
					{selectedChild.nickname}の実績
				</h3>

				<div class="flex flex-col gap-2">
					{#each selectedChild.achievements as achievement (achievement.id)}
						{@const unlocked =
							achievement.unlockedAt !== null ||
							achievement.highestUnlockedMilestone !== null}
						<div
							class="flex items-center gap-3 p-3 rounded-lg border
								{unlocked ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}"
						>
							<span class="text-2xl {unlocked ? '' : 'grayscale opacity-50'}">
								{achievement.icon}
							</span>
							<div class="flex-1 min-w-0">
								<p class="font-bold text-sm text-gray-700 truncate">
									{achievement.name}
								</p>
								<p class="text-xs text-gray-500">
									{#if achievement.repeatable && achievement.highestUnlockedMilestone}
										最高: {achievement.highestUnlockedMilestone}
										{#if achievement.nextMilestone}
											→ 次: {achievement.nextMilestone}
										{:else}
											（全達成）
										{/if}
									{:else if unlocked}
										達成済み
									{:else}
										{achievement.conditionLabel}
									{/if}
								</p>
							</div>
							<div class="text-right">
								<p class="text-xs font-bold text-blue-500">
									+{achievement.bonusPoints}P
								</p>
								{#if unlocked && achievement.unlockedAt}
									<p class="text-[10px] text-gray-400">
										{new Date(achievement.unlockedAt).toLocaleDateString('ja-JP')}
									</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	<DemoCta
		title="お子さまの成長の証を記録しませんか？"
		description="登録すると、実績やライフイベントの管理・ポイント付与ができます。"
	/>
</div>

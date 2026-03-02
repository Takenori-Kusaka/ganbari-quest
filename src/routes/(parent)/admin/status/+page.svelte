<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';

let { data, form } = $props();

const initialChildId = data.children[0]?.id ?? 0;
let selectedChildId = $state(initialChildId);
let editSuccess = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

const categoryLabels: Record<string, { label: string; icon: string }> = {
	うんどう: { label: 'うんどう', icon: '🏃' },
	べんきょう: { label: 'べんきょう', icon: '📚' },
	せいかつ: { label: 'せいかつ', icon: '🏠' },
	こうりゅう: { label: 'こうりゅう', icon: '🤝' },
	そうぞう: { label: 'そうぞう', icon: '🎨' },
};

function starText(stars: number): string {
	return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}
</script>

<svelte:head>
	<title>ステータス管理 - がんばりクエスト管理</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<h2 class="text-xl font-bold text-gray-700 mb-6">📊 ステータス管理</h2>

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
					onclick={() => {
						selectedChildId = child.id;
						editSuccess = false;
					}}
				>
					{child.nickname}
					{#if child.status}
						<span class="text-xs opacity-75">Lv.{child.status.level}</span>
					{/if}
				</button>
			{/each}
		</div>

		{#if selectedChild?.status}
			{#if editSuccess}
				<div
					class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-700"
				>
					ステータスを更新しました
				</div>
			{/if}

			{#if form?.error}
				<div
					class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700"
				>
					{form.error}
				</div>
			{/if}

			<!-- レベル情報 -->
			<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-500">レベル</p>
						<p class="text-2xl font-bold text-gray-700">
							Lv.{selectedChild.status.level}
						</p>
					</div>
					<div class="text-right">
						<p class="text-sm text-gray-500">称号</p>
						<p class="text-lg font-bold text-blue-600">
							{selectedChild.status.levelTitle}
						</p>
					</div>
				</div>
			</div>

			<!-- カテゴリ別ステータス -->
			<div class="flex flex-col gap-3">
				{#each data.categories as category (category)}
					{@const catInfo = categoryLabels[category] ?? { label: category, icon: '📌' }}
					{@const stat = selectedChild.status.statuses[category]}
					{#if stat}
						<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
							<div class="flex items-center justify-between mb-2">
								<div class="flex items-center gap-2">
									<span class="text-xl">{catInfo.icon}</span>
									<span class="font-bold text-gray-700">{catInfo.label}</span>
								</div>
								<span class="text-sm text-yellow-500">{starText(stat.stars)}</span>
							</div>

							<form
								method="POST"
								action="?/updateStatus"
								use:enhance={() => {
									editSuccess = false;
									return async ({ result }) => {
										if (result.type === 'success') {
											editSuccess = true;
											await invalidateAll();
										}
									};
								}}
								class="flex items-center gap-3"
							>
								<input type="hidden" name="childId" value={selectedChildId} />
								<input type="hidden" name="category" value={category} />
								<div class="flex-1">
									<input
										type="range"
										name="value"
										min="0"
										max="100"
										step="0.5"
										value={stat.value}
										class="w-full"
									/>
								</div>
								<span class="text-sm font-bold text-gray-600 w-12 text-right">
									{stat.value}
								</span>
								<button
									type="submit"
									class="px-3 py-1 bg-blue-500 text-white text-sm font-bold rounded-lg hover:bg-blue-600 transition-colors"
								>
									保存
								</button>
							</form>
						</div>
					{/if}
				{/each}
			</div>
		{:else if selectedChild}
			<div class="text-center text-gray-500 py-8">
				<p>ステータスデータがありません</p>
			</div>
		{/if}
	{:else}
		<div class="text-center text-gray-500 py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">子供が登録されていません</p>
		</div>
	{/if}
</div>

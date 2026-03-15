<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';

let { data, form } = $props();

const initialChildId = data.children[0]?.id ?? 0;
let selectedChildId = $state(initialChildId);
let editSuccess = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));



// スライダー操作中の値を追跡（カテゴリ名 → 現在値）
let sliderValues: Record<number, number> = $state({});

function starText(stars: number): string {
	return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}
</script>

<svelte:head>
	<title>ステータス管理 - がんばりクエスト管理</title>
</svelte:head>

<div class="space-y-6">
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
						sliderValues = {};
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
				<SuccessAlert message="ステータスを更新しました" />
			{/if}

			{#if form?.error}
				<ErrorAlert message={form.error} severity="warning" action="fix_input" />
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
				{#each data.categoryDefs as catDef (catDef.id)}
					
					{@const stat = selectedChild.status.statuses[catDef.id]}
					{#if stat}
						{@const maxVal = selectedChild.status?.maxValue ?? 100}
						{@const sliderStep = maxVal > 100 ? 1 : 0.5}
						{@const currentVal = sliderValues[catDef.id] ?? stat.value}
						{@const diff = currentVal - stat.value}
						{@const hasChanged = Math.abs(diff) >= 0.5}
						<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
							<div class="flex items-center justify-between mb-2">
								<div class="flex items-center gap-2">
									<span class="text-xl">{catDef.icon}</span>
									<span class="font-bold text-gray-700">{catDef.name}</span>
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
											delete sliderValues[catDef.id];
											await invalidateAll();
										}
									};
								}}
								class="space-y-2"
							>
								<input type="hidden" name="childId" value={selectedChildId} />
								<input type="hidden" name="categoryId" value={catDef.id} />
								<div>
									<input
										type="range"
										name="value"
										min="0"
										max={maxVal}
										step={sliderStep}
										value={currentVal}
										oninput={(e) => {
											sliderValues[catDef.id] = Number(e.currentTarget.value);
										}}
										class="w-full accent-blue-500"
									/>
								</div>
								<div class="flex items-center justify-between">
									<div>
										<span class="text-2xl font-bold text-gray-700">{currentVal}</span>
										<span class="text-sm text-gray-400"> / {maxVal}</span>
										{#if hasChanged}
											<span class="ml-2 text-sm font-bold {diff > 0 ? 'text-green-500' : 'text-red-500'}">
												{diff > 0 ? '+' : ''}{diff.toFixed(1)}
											</span>
										{/if}
									</div>
									<button
										type="submit"
										disabled={!hasChanged}
										class="px-4 py-1.5 text-sm font-bold rounded-lg transition-colors
											{hasChanged
											? 'bg-blue-500 text-white hover:bg-blue-600'
											: 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
									>
										保存
									</button>
								</div>
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

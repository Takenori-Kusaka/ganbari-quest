<script lang="ts">
import { goto } from '$app/navigation';
import { getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';

let { data } = $props();

let currentIndex = $state(0);

const total = $derived(data.activities.length);
const activity = $derived(data.activities[currentIndex]);
const categoryColor = $derived(
	activity ? (getCategoryById(activity.categoryId)?.color ?? '#888') : '#888',
);
const categoryName = $derived(activity ? (getCategoryById(activity.categoryId)?.name ?? '') : '');

function prev() {
	if (currentIndex > 0) currentIndex--;
}

function next() {
	if (currentIndex < total - 1) currentIndex++;
}

function finish() {
	goto('/admin/activities');
}
</script>

<svelte:head>
	<title>活動のおしえかた</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col">
	{#if total === 0}
		<div class="flex-1 flex flex-col items-center justify-center p-6">
			<span class="text-5xl mb-4">📋</span>
			<p class="text-lg font-bold text-gray-600">表示できる活動がありません</p>
			<p class="text-sm text-gray-400 mt-1">まず活動を追加してください</p>
			<button
				onclick={finish}
				class="mt-6 px-6 py-2 bg-gray-200 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-300 transition-colors"
			>
				もどる
			</button>
		</div>
	{:else if activity}
		<!-- Progress bar -->
		<div class="px-4 pt-4 pb-2">
			<div class="flex items-center justify-between text-xs text-gray-500 mb-1">
				<span>{currentIndex + 1} / {total} の活動</span>
				<span class="text-gray-400">{categoryName}</span>
			</div>
			<div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
				<div
					class="h-full rounded-full transition-all duration-300"
					style="width: {((currentIndex + 1) / total) * 100}%; background-color: {categoryColor};"
				></div>
			</div>
		</div>

		<!-- Card area -->
		<div class="flex-1 flex flex-col items-center justify-center px-6 py-4">
			<!-- Activity card (large) -->
			<div
				class="w-40 aspect-square rounded-2xl border-3 shadow-lg flex flex-col items-center justify-center gap-2 bg-white transition-all duration-300"
				style="border-color: {categoryColor};"
			>
				<CompoundIcon icon={activity.icon} size="xl" />
				<span class="text-base font-bold text-gray-700 text-center leading-tight px-2">
					{activity.name}
				</span>
			</div>

			<!-- Trigger hint balloon -->
			{#if activity.triggerHint}
				<div class="mt-6 max-w-xs w-full">
					<div class="relative bg-orange-50 border-2 border-orange-200 rounded-2xl px-5 py-4 text-center">
						<div class="absolute -top-2.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-orange-50 border-l-2 border-t-2 border-orange-200 rotate-45"></div>
						<p class="text-xs text-orange-400 font-bold mb-1">こどもに おしえてね</p>
						<p class="text-lg font-bold text-orange-600 leading-snug">
							「{activity.triggerHint}」
						</p>
					</div>
				</div>
			{:else if activity.description}
				<div class="mt-6 max-w-xs w-full">
					<div class="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center">
						<p class="text-xs text-gray-400 font-bold mb-1">活動の説明</p>
						<p class="text-sm text-gray-600 leading-snug">{activity.description}</p>
					</div>
				</div>
			{:else}
				<div class="mt-6 max-w-xs w-full">
					<div class="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center">
						<p class="text-sm text-gray-400">
							ヒントはまだ設定されていません
						</p>
						<p class="text-xs text-gray-300 mt-1">活動編集画面で「トリガーヒント」を設定できます</p>
					</div>
				</div>
			{/if}

			<!-- Points info -->
			<div class="mt-4 text-center">
				<span class="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-bold">
					⭐ {activity.basePoints}P
				</span>
			</div>
		</div>

		<!-- Navigation buttons -->
		<div class="px-4 pb-6 space-y-2">
			<div class="flex gap-2">
				<button
					onclick={prev}
					disabled={currentIndex === 0}
					class="flex-1 py-3 rounded-xl font-bold text-sm transition-colors
						{currentIndex === 0
						? 'bg-gray-100 text-gray-300'
						: 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}"
				>
					← まえへ
				</button>
				<button
					onclick={next}
					disabled={currentIndex >= total - 1}
					class="flex-1 py-3 rounded-xl font-bold text-sm transition-colors
						{currentIndex >= total - 1
						? 'bg-gray-100 text-gray-300'
						: 'bg-blue-500 text-white hover:bg-blue-600'}"
				>
					つぎへ →
				</button>
			</div>
			<button
				onclick={finish}
				class="w-full py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
			>
				おわる
			</button>
		</div>
	{/if}
</div>

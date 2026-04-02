<script lang="ts">
import { enhance } from '$app/forms';
import { splitIcon } from '$lib/domain/icon-utils';
import ActivityCreateForm from '$lib/features/admin/components/ActivityCreateForm.svelte';
import ActivityImportPanel from '$lib/features/admin/components/ActivityImportPanel.svelte';
import ActivityListItem from '$lib/features/admin/components/ActivityListItem.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import HiddenActivitiesSection from '$lib/features/admin/components/HiddenActivitiesSection.svelte';
import type { AiPreviewData } from '$lib/features/admin/components/activity-types';

let { data } = $props();
const activityLimit = $derived(
	(data as Record<string, unknown>).activityLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);

let showAddForm = $state(false);
let filterCategoryId = $state(0);
let searchQuery = $state('');
let aiMode = $state(false);
let showImportPanel = $state(false);
let showClearConfirm = $state(false);
let clearLoading = $state(false);
let editingId = $state<number | null>(null);
let actionMessage = $state('');

// Pre-filled values for create form (from AI suggestion)
let prefillName = $state('');
let prefillCategoryId = $state(1);
let prefillMainIcon = $state('🤸');
let prefillSubIcon = $state('');
let prefillPoints = $state(5);
let prefillNameKana = $state('');
let prefillNameKanji = $state('');

const filteredActivities = $derived.by(() => {
	let result = data.activities.filter((a) => a.isVisible);
	if (filterCategoryId) {
		result = result.filter((a) => a.categoryId === filterCategoryId);
	}
	if (searchQuery.trim()) {
		const q = searchQuery.trim().toLowerCase();
		result = result.filter(
			(a) =>
				a.name.toLowerCase().includes(q) ||
				a.nameKanji?.toLowerCase().includes(q) ||
				a.nameKana?.toLowerCase().includes(q),
		);
	}
	return result;
});

const hiddenActivities = $derived(data.activities.filter((a) => !a.isVisible));

function acceptAiPreview(preview: AiPreviewData) {
	prefillName = preview.name;
	prefillCategoryId = preview.categoryId;
	const aiParsed = splitIcon(preview.icon ?? '📝');
	prefillMainIcon = aiParsed.main;
	prefillSubIcon = aiParsed.sub ?? '';
	prefillPoints = preview.basePoints;
	prefillNameKana = preview.nameKana ?? '';
	prefillNameKanji = preview.nameKanji ?? '';
	aiMode = false;
	showAddForm = true;
}
</script>

<svelte:head>
	<title>活動管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-4">
	{#if activityLimit && !activityLimit.allowed}
		<div class="limit-banner">
			<span class="text-2xl">⚠️</span>
			<div>
				<p class="font-bold text-amber-800">カスタム活動の登録上限に達しています</p>
				<p class="text-sm text-amber-700 mt-1">
					現在 {activityLimit.current}個 / 最大 {activityLimit.max}個。
				</p>
				<a href="/admin/license" class="inline-flex items-center mt-2 text-sm font-semibold text-blue-600 hover:text-blue-800">
					🚀 プランをアップグレードする →
				</a>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between" data-tutorial="activity-list">
		{#if !activityLimit || activityLimit.allowed}
			<div class="flex gap-2" data-tutorial="add-activity-btn">
				<button
					class="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-bold hover:bg-purple-600 transition-colors"
					onclick={() => { aiMode = !aiMode; showAddForm = false; }}
				>
					{aiMode ? 'キャンセル' : '✨ AI追加'}
				</button>
				<button
					class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition-colors"
					onclick={() => { showAddForm = !showAddForm; aiMode = false; }}
				>
					{showAddForm ? 'キャンセル' : '+ 手動追加'}
				</button>
				<button
					class="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition-colors"
					onclick={() => { showImportPanel = !showImportPanel; }}
				>
					{showImportPanel ? 'キャンセル' : '📥 インポート'}
				</button>
			</div>
		{:else}
			<button
				class="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg text-sm font-bold cursor-not-allowed"
				disabled
			>
				上限に達しています
			</button>
		{/if}
	</div>

	{#if showImportPanel}
		<ActivityImportPanel
			activityPacks={data.activityPacks}
			onimported={(msg) => { actionMessage = msg; }}
			onclose={() => { showImportPanel = false; }}
		/>
	{/if}

	<!-- エクスポート・一括クリア -->
	<div class="flex gap-2 flex-wrap">
		<a
			href="/api/v1/activities/export"
			class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors inline-flex items-center gap-1"
			download="activities-export.json"
		>
			📤 エクスポート
		</a>
		{#if !showClearConfirm}
			<button
				class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors"
				onclick={() => { showClearConfirm = true; }}
			>
				🗑 全クリア
			</button>
		{:else}
			<form
				method="POST"
				action="?/clearAll"
				use:enhance={() => {
					clearLoading = true;
					return async ({ result, update }) => {
						clearLoading = false;
						showClearConfirm = false;
						if (result.type === 'success' && result.data && 'clearResult' in result.data) {
							const d = result.data as Record<string, unknown>;
							actionMessage = `🗑 ${d.deleted}件削除、${d.hidden}件非表示にしました`;
						}
						await update({ reset: false });
					};
				}}
				class="flex gap-1 items-center"
			>
				<span class="text-xs text-red-600 font-bold">本当に全削除しますか？</span>
				<button type="submit" disabled={clearLoading} class="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 disabled:opacity-50">
					{clearLoading ? '処理中...' : '実行'}
				</button>
				<button type="button" class="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold" onclick={() => { showClearConfirm = false; }}>
					やめる
				</button>
			</form>
		{/if}
	</div>

	{#if aiMode}
		<AiSuggestPanel onaccept={acceptAiPreview} />
	{/if}

	{#if showAddForm}
		<ActivityCreateForm
			categoryDefs={data.categoryDefs}
			initialName={prefillName}
			initialCategoryId={prefillCategoryId}
			initialMainIcon={prefillMainIcon}
			initialSubIcon={prefillSubIcon}
			initialPoints={prefillPoints}
			initialNameKana={prefillNameKana}
			initialNameKanji={prefillNameKanji}
			oncreated={() => { showAddForm = false; }}
		/>
	{/if}

	<!-- 活動紹介フロー -->
	<a
		href="/admin/activities/introduce"
		class="introduce-link"
	>
		<div class="flex items-center gap-3">
			<span class="text-2xl">📖</span>
			<div class="flex-1">
				<p class="font-bold text-gray-700 text-sm">活動の紹介スライド</p>
				<p class="text-xs text-gray-500 mt-0.5">お子さんと一緒に各活動の内容や記録方法を確認できます</p>
			</div>
			<span class="text-gray-400 text-sm">→</span>
		</div>
	</a>

	<!-- Search -->
	<div class="relative">
		<input
			type="search"
			bind:value={searchQuery}
			placeholder="活動名で検索..."
			class="w-full px-3 py-2 pl-9 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
		/>
		<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
	</div>

	<!-- Filter -->
	<div class="flex gap-2 flex-wrap" data-tutorial="category-filter">
		<button
			class="px-3 py-1 rounded-full text-xs font-bold transition-colors
				{filterCategoryId === 0 ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
			onclick={() => filterCategoryId = 0}
		>
			すべて ({data.activities.filter(a => a.isVisible).length})
		</button>
		{#each data.categoryDefs as catDef}
			{@const count = data.activities.filter(a => a.categoryId === catDef.id && a.isVisible).length}
			<button
				class="px-3 py-1 rounded-full text-xs font-bold transition-colors
					{filterCategoryId === catDef.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</button>
		{/each}
	</div>

	<!-- Action message -->
	{#if actionMessage}
		<div class="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg text-sm">
			{actionMessage}
		</div>
	{/if}

	<!-- Activity List -->
	<div class="space-y-1">
		{#each filteredActivities as activity (activity.id)}
			<ActivityListItem
				{activity}
				categoryDefs={data.categoryDefs}
				logCount={data.logCounts[activity.id] ?? 0}
				isEditing={editingId === activity.id}
				onedit={() => { editingId = activity.id; }}
				oncanceledit={() => { editingId = null; }}
			/>
		{/each}
	</div>

	<HiddenActivitiesSection
		activities={hiddenActivities}
		logCounts={data.logCounts}
	/>
</div>

<style>
	.limit-banner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 0.75rem;
		background-color: rgb(255 251 235);
		border: 1px solid rgb(253 230 138);
	}

	.introduce-link {
		display: block;
		padding: 1rem;
		border-radius: 0.75rem;
		border: 1px solid rgb(253 186 116);
		background: linear-gradient(to right, rgb(255 247 237), rgb(255 251 235));
		transition: box-shadow 0.15s;
	}

	.introduce-link:hover {
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
	}
</style>

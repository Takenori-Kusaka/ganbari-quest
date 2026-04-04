<script lang="ts">
import { enhance } from '$app/forms';
import { splitIcon } from '$lib/domain/icon-utils';
import ActivityCreateForm from '$lib/features/admin/components/ActivityCreateForm.svelte';
import ActivityImportPanel from '$lib/features/admin/components/ActivityImportPanel.svelte';
import ActivityListItem from '$lib/features/admin/components/ActivityListItem.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import type { AiPreviewData } from '$lib/features/admin/components/activity-types';
import HiddenActivitiesSection from '$lib/features/admin/components/HiddenActivitiesSection.svelte';
import PremiumBadge from '$lib/ui/components/PremiumBadge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

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
			<div class="flex items-center gap-2" data-tutorial="add-activity-btn">
				<Button
					variant="primary"
					size="sm"
					class="bg-purple-500 hover:bg-purple-600"
					onclick={() => { aiMode = !aiMode; showAddForm = false; }}
				>
					{aiMode ? 'キャンセル' : '✨ AI追加'}
				</Button>
				<Button
					variant="primary"
					size="sm"
					onclick={() => { showAddForm = !showAddForm; aiMode = false; }}
				>
					{showAddForm ? 'キャンセル' : '+ 手動追加'}
				</Button>
				<Button
					variant="success"
					size="sm"
					onclick={() => { showImportPanel = !showImportPanel; }}
				>
					{showImportPanel ? 'キャンセル' : '📥 インポート'}
				</Button>
				{#if !data.isPremium}
					<PremiumBadge size="sm" label="プレミアム" />
				{/if}
			</div>
		{:else}
			<div class="flex items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					class="bg-gray-300 text-gray-500 cursor-not-allowed"
					disabled
				>
					上限に達しています
				</Button>
				<PremiumBadge size="sm" label="プレミアム" />
			</div>
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
			<Button
				variant="danger"
				size="sm"
				class="bg-red-50 text-red-600 hover:bg-red-100 text-xs"
				onclick={() => { showClearConfirm = true; }}
			>
				🗑 全クリア
			</Button>
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
				<Button type="submit" disabled={clearLoading} variant="danger" size="sm" class="text-xs">
					{clearLoading ? '処理中...' : '実行'}
				</Button>
				<Button type="button" variant="ghost" size="sm" class="bg-gray-200 text-gray-700 text-xs" onclick={() => { showClearConfirm = false; }}>
					やめる
				</Button>
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
	<FormField label="🔍 活動名で検索" type="search" bind:value={searchQuery} placeholder="活動名で検索..." />

	<!-- Filter -->
	<div class="flex gap-2 flex-wrap" data-tutorial="category-filter">
		<Button
			variant={filterCategoryId === 0 ? 'primary' : 'ghost'}
			size="sm"
			class="rounded-full text-xs {filterCategoryId === 0 ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
			onclick={() => filterCategoryId = 0}
		>
			すべて ({data.activities.filter(a => a.isVisible).length})
		</Button>
		{#each data.categoryDefs as catDef}
			{@const count = data.activities.filter(a => a.categoryId === catDef.id && a.isVisible).length}
			<Button
				variant={filterCategoryId === catDef.id ? 'primary' : 'ghost'}
				size="sm"
				class="rounded-full text-xs {filterCategoryId === catDef.id ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</Button>
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

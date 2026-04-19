<script lang="ts">
import { splitIcon } from '$lib/domain/icon-utils';
import ActivitiesHeader from '$lib/features/admin/components/ActivitiesHeader.svelte';
import ActivityClearAllConfirm from '$lib/features/admin/components/ActivityClearAllConfirm.svelte';
import ActivityCreateForm from '$lib/features/admin/components/ActivityCreateForm.svelte';
import ActivityEmptyState from '$lib/features/admin/components/ActivityEmptyState.svelte';
import ActivityImportPanel from '$lib/features/admin/components/ActivityImportPanel.svelte';
import ActivityLimitBanner from '$lib/features/admin/components/ActivityLimitBanner.svelte';
import ActivityListItem from '$lib/features/admin/components/ActivityListItem.svelte';
import AddActivityFab from '$lib/features/admin/components/AddActivityFab.svelte';
import AddActivityModeSelector from '$lib/features/admin/components/AddActivityModeSelector.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import type { AiPreviewData } from '$lib/features/admin/components/activity-types';
import HiddenActivitiesSection from '$lib/features/admin/components/HiddenActivitiesSection.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();
const activityLimit = $derived(
	(data as Record<string, unknown>).activityLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);

let filterCategoryId = $state(0);
let searchQuery = $state('');
let editingId = $state<number | null>(null);
let actionMessage = $state('');
let showClearConfirm = $state(false);
let clearLoading = $state(false);

// 追加ダイアログ
let showAddDialog = $state(false);
let addMode = $state<'manual' | 'ai' | 'import' | null>(null);

// AI プレフィル
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
const canAdd = $derived(!activityLimit || activityLimit.allowed);

function openAddDialog(mode: 'manual' | 'ai' | 'import') {
	addMode = mode;
	showAddDialog = true;
}

function closeAddDialog() {
	showAddDialog = false;
	addMode = null;
}

function acceptAiPreview(preview: AiPreviewData) {
	prefillName = preview.name;
	prefillCategoryId = preview.categoryId;
	const aiParsed = splitIcon(preview.icon ?? '📝');
	prefillMainIcon = aiParsed.main;
	prefillSubIcon = aiParsed.sub ?? '';
	prefillPoints = preview.basePoints;
	prefillNameKana = preview.nameKana ?? '';
	prefillNameKanji = preview.nameKanji ?? '';
	addMode = 'manual';
}
</script>

<svelte:head>
	<title>活動管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-3">
	<ActivitiesHeader
		clearConfirmOpen={showClearConfirm}
		onClearAll={() => { showClearConfirm = true; }}
	/>

	{#if showClearConfirm}
		<ActivityClearAllConfirm
			bind:loading={clearLoading}
			onsubmit={() => {}}
			onresult={(msg) => { actionMessage = msg; showClearConfirm = false; }}
			oncancel={() => { showClearConfirm = false; }}
		/>
	{/if}

	{#if activityLimit && !activityLimit.allowed}
		<ActivityLimitBanner current={activityLimit.current} max={activityLimit.max} />
	{/if}

	<!-- カテゴリフィルタ -->
	<div class="filter-row" data-tutorial="category-filter">
		<Button
			variant={filterCategoryId === 0 ? 'primary' : 'ghost'}
			size="sm"
			class="filter-chip {filterCategoryId === 0 ? '' : 'filter-chip--inactive'}"
			onclick={() => filterCategoryId = 0}
		>
			すべて ({data.activities.filter(a => a.isVisible).length})
		</Button>
		{#each data.categoryDefs as catDef}
			{@const count = data.activities.filter(a => a.categoryId === catDef.id && a.isVisible).length}
			<Button
				variant={filterCategoryId === catDef.id ? 'primary' : 'ghost'}
				size="sm"
				class="filter-chip {filterCategoryId === catDef.id ? '' : 'filter-chip--inactive'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</Button>
		{/each}
	</div>

	<!-- 検索 -->
	<FormField id="activity-search" label="活動名で検索" type="search" bind:value={searchQuery} placeholder="🔍 活動名で検索..." />

	<!-- アクションメッセージ -->
	{#if actionMessage}
		<div class="action-message">
			{actionMessage}
		</div>
	{/if}

	<!-- 活動一覧（メインコンテンツ） -->
	<div class="space-y-1" data-tutorial="activity-list">
		{#each filteredActivities as activity (activity.id)}
			<ActivityListItem
				{activity}
				categoryDefs={data.categoryDefs}
				logCount={data.logCounts[activity.id] ?? 0}
				isEditing={editingId === activity.id}
				mainQuestCount={data.mainQuestCount ?? 0}
				mainQuestMax={data.mainQuestMax ?? 3}
				onedit={() => { editingId = activity.id; }}
				oncanceledit={() => { editingId = null; }}
			/>
		{:else}
			<ActivityEmptyState
				hasFilter={Boolean(searchQuery || filterCategoryId)}
				{canAdd}
				onAdd={() => openAddDialog('manual')}
			/>
		{/each}
	</div>

	<HiddenActivitiesSection
		activities={hiddenActivities}
		logCounts={data.logCounts}
	/>

	<AddActivityFab
		enabled={canAdd}
		onclick={() => { showAddDialog = true; addMode = null; }}
	/>

	<Dialog bind:open={showAddDialog} title={addMode === 'ai' ? '✨ AI で活動を追加' : addMode === 'import' ? '📥 パックからインポート' : addMode === 'manual' ? '+ 手動で追加' : '活動を追加'} testid="add-activity-dialog">
		{#if !addMode}
			<AddActivityModeSelector onselect={(mode) => { addMode = mode; }} />
		{:else if addMode === 'ai'}
			<Button variant="ghost" size="sm" onclick={() => { addMode = null; }} class="mb-2">← 戻る</Button>
			<AiSuggestPanel onaccept={acceptAiPreview} isFamily={data.planTier === 'family'} />
		{:else if addMode === 'manual'}
			<Button variant="ghost" size="sm" onclick={() => { addMode = null; }} class="mb-2">← 戻る</Button>
			<ActivityCreateForm
				categoryDefs={data.categoryDefs}
				initialName={prefillName}
				initialCategoryId={prefillCategoryId}
				initialMainIcon={prefillMainIcon}
				initialSubIcon={prefillSubIcon}
				initialPoints={prefillPoints}
				initialNameKana={prefillNameKana}
				initialNameKanji={prefillNameKanji}
				oncreated={() => { closeAddDialog(); }}
			/>
		{:else if addMode === 'import'}
			<Button variant="ghost" size="sm" onclick={() => { addMode = null; }} class="mb-2">← 戻る</Button>
			<ActivityImportPanel
				activityPacks={data.activityPacks}
				onimported={(msg) => { actionMessage = msg; closeAddDialog(); }}
				onclose={() => { addMode = null; }}
			/>
		{/if}
	</Dialog>
</div>

<style>
	.filter-row {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}
	:global(.filter-chip) {
		border-radius: 9999px !important;
		font-size: 0.75rem !important;
	}
	:global(.filter-chip--inactive) {
		background: var(--color-surface-muted) !important;
		color: var(--color-text-secondary) !important;
	}

	.action-message {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-feedback-warning-bg);
		border: 1px solid var(--color-feedback-warning-border);
		color: var(--color-feedback-warning-text);
		font-size: 0.85rem;
	}
</style>

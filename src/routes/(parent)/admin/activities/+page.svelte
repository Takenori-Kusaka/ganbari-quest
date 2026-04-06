<script lang="ts">
import { enhance } from '$app/forms';
import { splitIcon } from '$lib/domain/icon-utils';
import ActivityCreateForm from '$lib/features/admin/components/ActivityCreateForm.svelte';
import ActivityImportPanel from '$lib/features/admin/components/ActivityImportPanel.svelte';
import ActivityListItem from '$lib/features/admin/components/ActivityListItem.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import type { AiPreviewData } from '$lib/features/admin/components/activity-types';
import HiddenActivitiesSection from '$lib/features/admin/components/HiddenActivitiesSection.svelte';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import PremiumBadge from '$lib/ui/components/PremiumBadge.svelte';
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
	<!-- ヘッダー: タイトル + ツールバー -->
	<div class="activities-header">
		<div class="flex items-center gap-2">
			<h2 class="activities-title">📋 活動管理</h2>
			<PageHelpButton />
		</div>
		<div class="activities-toolbar">
			<a
				href="/api/v1/activities/export"
				class="toolbar-btn"
				download="activities-export.json"
				aria-label="エクスポート"
			>
				📤
			</a>
			<a href="/admin/activities/introduce" class="toolbar-btn" aria-label="活動の紹介">
				📖
			</a>
			{#if !showClearConfirm}
				<button type="button" class="toolbar-btn toolbar-btn--danger" onclick={() => { showClearConfirm = true; }} aria-label="全クリア">
					🗑
				</button>
			{/if}
		</div>
	</div>

	<!-- 一括クリア確認 -->
	{#if showClearConfirm}
		<div class="clear-confirm">
			<span class="clear-confirm__text">本当に全削除しますか？</span>
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
				class="clear-confirm__actions"
			>
				<Button type="submit" disabled={clearLoading} variant="danger" size="sm">
					{clearLoading ? '処理中...' : '実行'}
				</Button>
				<Button type="button" variant="ghost" size="sm" onclick={() => { showClearConfirm = false; }}>
					やめる
				</Button>
			</form>
		</div>
	{/if}

	<!-- 上限バナー -->
	{#if activityLimit && !activityLimit.allowed}
		<div class="limit-banner">
			<span>⚠️</span>
			<div>
				<p class="limit-banner__title">登録上限に達しています（{activityLimit.current}/{activityLimit.max}）</p>
				<a href="/admin/license" class="limit-banner__link">プランをアップグレード →</a>
			</div>
		</div>
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
				onedit={() => { editingId = activity.id; }}
				oncanceledit={() => { editingId = null; }}
			/>
		{:else}
			<div class="empty-state">
				<p class="empty-state__icon">📋</p>
				<p class="empty-state__text">
					{searchQuery || filterCategoryId ? 'この条件に一致する活動はありません' : '活動がまだ登録されていません'}
				</p>
				{#if canAdd}
					<Button variant="primary" size="sm" onclick={() => openAddDialog('manual')}>
						+ 活動を追加する
					</Button>
				{/if}
			</div>
		{/each}
	</div>

	<HiddenActivitiesSection
		activities={hiddenActivities}
		logCounts={data.logCounts}
	/>

	<!-- FAB: 追加ボタン -->
	{#if canAdd}
		<button
			type="button"
			class="fab"
			data-tutorial="add-activity-btn"
			onclick={() => { showAddDialog = true; addMode = null; }}
			aria-label="活動を追加"
		>
			<span class="fab__icon">+</span>
		</button>
	{:else}
		<button
			type="button"
			class="fab fab--disabled"
			aria-label="追加上限"
			aria-disabled="true"
			disabled
		>
			<span class="fab__icon">+</span>
		</button>
	{/if}

	<!-- 追加ダイアログ -->
	<Dialog bind:open={showAddDialog} title={addMode === 'ai' ? '✨ AI で活動を追加' : addMode === 'import' ? '📥 パックからインポート' : addMode === 'manual' ? '+ 手動で追加' : '活動を追加'} testid="add-activity-dialog">
		{#if !addMode}
			<!-- モード選択 -->
			<div class="add-mode-grid">
				<button type="button" class="add-mode-card" onclick={() => { addMode = 'ai'; }}>
					<span class="add-mode-card__icon">✨</span>
					<span class="add-mode-card__label">AIで追加</span>
					<span class="add-mode-card__desc">AIが活動を提案します</span>
				</button>
				<button type="button" class="add-mode-card" onclick={() => { addMode = 'manual'; }}>
					<span class="add-mode-card__icon">✏️</span>
					<span class="add-mode-card__label">手動で追加</span>
					<span class="add-mode-card__desc">名前やポイントを設定</span>
				</button>
				<button type="button" class="add-mode-card" onclick={() => { addMode = 'import'; }}>
					<span class="add-mode-card__icon">📥</span>
					<span class="add-mode-card__label">パックから追加</span>
					<span class="add-mode-card__desc">おすすめセットを一括追加</span>
				</button>
			</div>
		{:else if addMode === 'ai'}
			<Button variant="ghost" size="sm" onclick={() => { addMode = null; }} class="mb-2">← 戻る</Button>
			<AiSuggestPanel onaccept={acceptAiPreview} />
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
	.activities-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.activities-title {
		font-size: 1.125rem;
		font-weight: 700;
	}
	.activities-toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm, 6px);
		background: transparent;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.15s;
	}
	.toolbar-btn:hover {
		background: var(--color-surface-muted, #f3f4f6);
	}
	.toolbar-btn--danger:hover {
		background: var(--color-feedback-error-bg, #fef2f2);
	}

	.clear-confirm {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md, 8px);
		background: var(--color-feedback-error-bg, #fef2f2);
		border: 1px solid var(--color-feedback-error-border, #fecaca);
	}
	.clear-confirm__text {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-feedback-error-text, #dc2626);
	}
	.clear-confirm__actions {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}

	.limit-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-md, 8px);
		background: var(--color-feedback-warning-bg, #fffbeb);
		border: 1px solid var(--color-feedback-warning-border, #fde68a);
		font-size: 0.85rem;
	}
	.limit-banner__title {
		font-weight: 700;
		color: var(--color-feedback-warning-text, #92400e);
	}
	.limit-banner__link {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-action-primary, #3b82f6);
	}

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
		background: var(--color-surface-muted, #f3f4f6) !important;
		color: var(--color-text-secondary, #6b7280) !important;
	}

	.action-message {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md, 8px);
		background: var(--color-feedback-warning-bg, #fffbeb);
		border: 1px solid var(--color-feedback-warning-border, #fde68a);
		color: var(--color-feedback-warning-text, #92400e);
		font-size: 0.85rem;
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}
	.empty-state__icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}
	.empty-state__text {
		font-size: 0.875rem;
		color: var(--color-text-tertiary, #9ca3af);
		margin-bottom: 0.75rem;
	}

	/* FAB */
	.fab {
		position: fixed;
		bottom: calc(var(--bottom-nav-height, 64px) + 1rem);
		right: 1rem;
		z-index: 30;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: var(--color-action-primary, #3b82f6);
		color: white;
		border: none;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.15s, box-shadow 0.15s;
	}
	.fab:hover {
		transform: scale(1.05);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
	}
	.fab:active {
		transform: scale(0.95);
	}
	.fab--disabled {
		background: var(--color-surface-muted-strong, #d1d5db);
		cursor: not-allowed;
		pointer-events: none;
	}
	.fab__icon {
		font-size: 1.75rem;
		font-weight: 300;
		line-height: 1;
	}

	@media (min-width: 768px) {
		.fab {
			bottom: 2rem;
			right: 2rem;
		}
	}

	/* 追加モード選択 */
	.add-mode-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	.add-mode-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 1rem;
		border: 1px solid var(--color-border-default, #e5e7eb);
		border-radius: var(--radius-md, 8px);
		background: white;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.add-mode-card:hover {
		border-color: var(--color-action-primary, #3b82f6);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	.add-mode-card__icon {
		font-size: 1.5rem;
	}
	.add-mode-card__label {
		font-weight: 700;
		font-size: 0.9rem;
		color: var(--color-text-primary, #374151);
	}
	.add-mode-card__desc {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
</style>

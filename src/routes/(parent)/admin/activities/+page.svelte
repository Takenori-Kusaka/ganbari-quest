<script lang="ts">
import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { splitIcon } from '$lib/domain/icon-utils';
import {
	ADMIN_ACTIVITIES_PAGE_LABELS,
	APP_LABELS,
	FEATURES_LABELS,
	PAGE_TITLES,
	UI_LABELS,
} from '$lib/domain/labels';
import { CHILD_TERMS } from '$lib/domain/terms';
import ActivitiesHeader from '$lib/features/admin/components/ActivitiesHeader.svelte';
import ActivityClearAllConfirm from '$lib/features/admin/components/ActivityClearAllConfirm.svelte';
import ActivityCreateForm from '$lib/features/admin/components/ActivityCreateForm.svelte';
import ActivityEmptyState from '$lib/features/admin/components/ActivityEmptyState.svelte';
import ActivityLimitBanner from '$lib/features/admin/components/ActivityLimitBanner.svelte';
import ActivityListItem from '$lib/features/admin/components/ActivityListItem.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import type { AiPreviewData } from '$lib/features/admin/components/activity-types';
import HiddenActivitiesSection from '$lib/features/admin/components/HiddenActivitiesSection.svelte';
import UnifiedImportHub from '$lib/marketplace/ui/UnifiedImportHub.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import ChildSelectionDialog, {
	type ChildOption,
} from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

// #2362 PR-3 Phase 7c: hardcoded text 排除 (ADR-0045) — CHILD_TERMS.honorific を template literal で参照
const CHILD_HONORIFIC_LABEL = CHILD_TERMS.honorific;
let { data } = $props();
const activityLimit = $derived(
	(data as Record<string, unknown>).activityLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);

let filterCategoryId = $state(0);
let searchQuery = $state('');
let actionMessage = $state('');
let showClearConfirm = $state(false);
let clearLoading = $state(false);

// 追加ダイアログ (EPIC #2253 / #2255: header + dropdown menu で必ず mode が確定する)
let showAddDialog = $state(false);
let addMode = $state<'manual' | 'ai' | 'import' | null>(null);

// #2362 PR-3 Phase 4: 子供タブ切替 UI
// `?childId=<n>` query で初期 child 復元、未指定なら最初の child
let childIdOverride = $state<number | undefined>(
	data.initialChildId != null && data.children.some((c) => c.id === data.initialChildId)
		? data.initialChildId
		: undefined,
);
const selectedChildId = $derived(
	childIdOverride !== undefined && data.children.some((c) => c.id === childIdOverride)
		? childIdOverride
		: (data.children[0]?.id ?? 0),
);
const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// 選択中 child の per-child activity 一覧 (Phase 6/7 で完全切替予定、現状は family master と並存表示)
const perChildActivities = $derived(
	selectedChildId ? (data.childActivitiesByChild[selectedChildId] ?? []) : [],
);

// ChildSelectionDialog state (per-child 取込時 auto-open)
let showChildSelectionDialog = $state(false);
let pendingImportPresetId = $state<string | null>(null);

// 「他の子供から copy」dialog
let showCopyFromChildDialog = $state(false);
let copySourceChildId = $state<number | null>(null);

// 「一括追加」dialog (manual create で複数 child 同時 create)
let showBulkCreateDialog = $state(false);

// `?import=<presetId>` で auto-open
$effect(() => {
	if (data.importPresetId && !showChildSelectionDialog) {
		pendingImportPresetId = data.importPresetId;
		showChildSelectionDialog = true;
	}
});

// ChildSelectionDialog 用の ChildOption 配列
const childOptions = $derived<ChildOption[]>(
	data.children.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		age: c.age,
		icon: undefined,
	})),
);

// AI プレフィル
let prefillName = $state('');
let prefillCategoryId = $state(1);
let prefillMainIcon = $state('🤸');
let prefillSubIcon = $state('');
let prefillPoints = $state(5);
let prefillNameKana = $state('');
let prefillNameKanji = $state('');

// #2362 PR-3 Phase 4: child タブで選択中 child の per-child + family master 両方を一覧
// per-child は ChildActivity (childId 必須)、family master Activity (childId なし) と並存期間表示
type DisplayActivity = {
	id: number;
	scope: 'per-child' | 'family';
	categoryId: number;
	name: string;
	icon: string;
	basePoints: number;
	isVisible: boolean;
	nameKana: string | null;
	nameKanji: string | null;
};

const displayActivities = $derived<DisplayActivity[]>([
	...perChildActivities.map((a) => ({
		id: a.id,
		scope: 'per-child' as const,
		categoryId: a.categoryId,
		name: a.name,
		icon: a.icon,
		basePoints: a.basePoints,
		// ChildActivity.isVisible は SQLite 0/1 (number)、family master は boolean のため正規化
		isVisible: Boolean(a.isVisible),
		nameKana: a.nameKana,
		nameKanji: a.nameKanji,
	})),
	// Phase 6/7 完全切替まで family master も表示 (旧来 admin UX 維持)
	...data.activities
		.filter((a) => a.isVisible)
		.map((a) => ({
			id: a.id,
			scope: 'family' as const,
			categoryId: a.categoryId,
			name: a.name,
			icon: a.icon,
			basePoints: a.basePoints,
			// Activity (SQLite 0/1 number) / ChildActivity (boolean) 双方を boolean に正規化
			isVisible: Boolean(a.isVisible),
			nameKana: a.nameKana,
			nameKanji: a.nameKanji,
		})),
]);

const filteredActivities = $derived.by(() => {
	let result = displayActivities;
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

// ChildSelectionDialog 確定ハンドラ: 'all' or number[] (選択 child IDs)
async function handleChildSelectionConfirm(result: 'all' | number[]) {
	if (!pendingImportPresetId) {
		showChildSelectionDialog = false;
		return;
	}
	const childIdsValue = result === 'all' ? 'all' : result.join(',');
	const formData = new FormData();
	formData.append('packId', pendingImportPresetId);
	formData.append('childIds', childIdsValue);

	const resp = await fetch('?/importPackToChildren', { method: 'POST', body: formData });
	// #2558: imported 件数を読んで正直に出し分ける。
	// imported=0 (選んだ子に全て追加済み) を generic な「完了」で誤魔化さない。
	if (resp.ok) {
		const result = deserialize(await resp.text());
		const imported =
			result.type === 'success' ? Number((result.data?.imported as number | undefined) ?? 0) : 0;
		actionMessage =
			imported > 0
				? ADMIN_ACTIVITIES_PAGE_LABELS.importSuccess(imported)
				: ADMIN_ACTIVITIES_PAGE_LABELS.importAllDuplicates;
		await invalidateAll();
	} else {
		actionMessage = ADMIN_ACTIVITIES_PAGE_LABELS.importFailed;
	}
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
}

function handleChildSelectionCancel() {
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
}

// 「他の子供から copy」action
async function handleCopyFromChild() {
	if (!copySourceChildId || !selectedChildId || copySourceChildId === selectedChildId) {
		actionMessage = '違うお子さまを選んでください';
		return;
	}
	const formData = new FormData();
	formData.append('sourceChildId', String(copySourceChildId));
	formData.append('targetChildId', String(selectedChildId));

	const resp = await fetch('?/copyFromChild', { method: 'POST', body: formData });
	if (resp.ok) {
		actionMessage = 'コピーが完了しました';
		showCopyFromChildDialog = false;
		copySourceChildId = null;
		await invalidateAll();
	} else {
		actionMessage = 'コピーに失敗しました';
	}
}

// 「一括追加」action — 簡易フォーム (本番 ActivityCreateForm は単一 child 想定なので、
// bulk は最小形で実装。Phase 5 で UX 拡充予定)
let bulkName = $state('');
let bulkCategoryId = $state(1);
let bulkIcon = $state('📝');
let bulkPoints = $state(5);
let bulkTargets = $state<'all' | number[]>('all');

async function handleBulkCreate(targets: 'all' | number[]) {
	if (!bulkName.trim()) {
		actionMessage = '名前を入力してください';
		return;
	}
	const childIdsValue = targets === 'all' ? 'all' : targets.join(',');
	const formData = new FormData();
	formData.append('name', bulkName.trim());
	formData.append('categoryId', String(bulkCategoryId));
	formData.append('icon', bulkIcon);
	formData.append('basePoints', String(bulkPoints));
	formData.append('childIds', childIdsValue);

	const resp = await fetch('?/bulkCreateForChildren', { method: 'POST', body: formData });
	if (resp.ok) {
		actionMessage = '一括追加しました';
		showBulkCreateDialog = false;
		bulkName = '';
		await invalidateAll();
	} else {
		actionMessage = '一括追加に失敗しました';
	}
}

// 子供タブクリック時に URL を `?childId=<n>` に同期 (share link / refresh 対応)
function selectChild(childId: number) {
	childIdOverride = childId;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.set('childId', String(childId));
		window.history.replaceState({}, '', url.toString());
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.activities}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-3">
	<ActivitiesHeader
		clearConfirmOpen={showClearConfirm}
		onClearAll={() => { showClearConfirm = true; }}
		{canAdd}
		onAddSelect={openAddDialog}
	/>

	<!-- #2362 PR-3 Phase 4: 子供タブ切替 UI -->
	{#if data.children.length > 0}
		<div
			class="child-tab-row"
			data-testid="admin-activities-child-tabs"
			role="tablist"
			aria-label={ADMIN_ACTIVITIES_PAGE_LABELS.childTabsAriaLabel}
		>
			{#each data.children as child (child.id)}
				{@const count = (data.childActivitiesByChild[child.id] ?? []).length}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="child-tab {selectedChildId === child.id ? '' : 'child-tab--inactive'}"
					data-testid="child-tab-{child.id}"
					role="tab"
					aria-selected={selectedChildId === child.id}
					onclick={() => selectChild(child.id)}
				>
					{child.nickname}
					<span class="child-tab__count">({count})</span>
				</Button>
			{/each}

			<!-- 兄弟共通化 actions (右寄せ) -->
			<div class="child-tab-actions">
				{#if data.children.length >= 2}
					<Button
						variant="ghost"
						size="sm"
						data-testid="copy-from-child-btn"
						onclick={() => { showCopyFromChildDialog = true; }}
					>
						{ADMIN_ACTIVITIES_PAGE_LABELS.copyFromChildButton}
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					data-testid="bulk-create-btn"
					disabled={!canAdd}
					onclick={() => { showBulkCreateDialog = true; }}
				>
					{ADMIN_ACTIVITIES_PAGE_LABELS.bulkCreateButton}
				</Button>
			</div>
		</div>

		{#if selectedChild}
			<div class="child-context-banner" data-testid="child-context-banner">
				<span class="child-context-banner__label">
					{selectedChild.nickname}{ADMIN_ACTIVITIES_PAGE_LABELS.childContextActivitiesSuffix(perChildActivities.length)}
				</span>
				<span class="child-context-banner__hint">
					{ADMIN_ACTIVITIES_PAGE_LABELS.childContextHint}
				</span>
			</div>
		{/if}
	{/if}

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
			{UI_LABELS.all} ({displayActivities.length})
		</Button>
		{#each data.categoryDefs as catDef}
			{@const count = displayActivities.filter(a => a.categoryId === catDef.id).length}
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

	<!-- 活動一覧（メインコンテンツ）— per-child + family master 並存表示 (Phase 6/7 で完全切替予定) -->
	<div class="space-y-1" data-tutorial="activity-list">
		{#each filteredActivities as activity (`${activity.scope}-${activity.id}`)}
			{#if activity.scope === 'family'}
				<!-- family master Activity (旧来 ActivityListItem を使用) -->
				{#each data.activities.filter((a) => a.id === activity.id && a.isVisible) as origActivity}
					<ActivityListItem
						activity={origActivity}
						mainQuestCount={data.mainQuestCount ?? 0}
						mainQuestMax={data.mainQuestMax ?? 3}
					/>
				{/each}
			{:else}
				<!-- per-child ChildActivity (簡易表示、Phase 5 で list item refactor 予定) -->
				<div class="per-child-item" data-testid="per-child-activity-{activity.id}">
					<span class="per-child-item__icon">{activity.icon}</span>
					<span class="per-child-item__name">{activity.name}</span>
					<span class="per-child-item__points">{activity.basePoints} pt</span>
					<span class="per-child-item__scope-badge">per-child</span>
				</div>
			{/if}
		{:else}
			<ActivityEmptyState
				hasFilter={Boolean(searchQuery || filterCategoryId)}
				{canAdd}
				onAdd={(mode) => openAddDialog(mode)}
			/>
		{/each}
	</div>

	<HiddenActivitiesSection
		activities={hiddenActivities}
		logCounts={data.logCounts}
	/>

	<Dialog bind:open={showAddDialog} title={addMode === 'ai' ? FEATURES_LABELS.activitiesHeader.addDialogTitleAi : addMode === 'import' ? FEATURES_LABELS.activitiesHeader.addDialogTitleImport : FEATURES_LABELS.activitiesHeader.addDialogTitleManual} testid="add-activity-dialog">
		{#if addMode === 'ai'}
			<AiSuggestPanel onaccept={acceptAiPreview} isFamily={data.planTier === 'family'} />
		{:else if addMode === 'manual'}
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
			<!-- #2370 (EPIC #2362 P4): UnifiedImportHub に置換、PO 指摘 ② 直接解決 -->
			<UnifiedImportHub
				typeCode="activity-pack"
				presets={{
					'activity-pack': data.activityPacks.map((p) => ({
						itemId: p.packId,
						name: p.packName,
						icon: p.icon,
						itemCount: p.activityCount,
						targetAgeMin: p.targetAgeMin,
						targetAgeMax: p.targetAgeMax,
					})),
				}}
				onimported={(msg) => { actionMessage = msg; closeAddDialog(); }}
				onclose={() => { closeAddDialog(); }}
			/>
		{/if}
	</Dialog>

	<!-- #2362 PR-3 Phase 4: ChildSelectionDialog (`?import=<presetId>` auto-open) -->
	<ChildSelectionDialog
		bind:open={showChildSelectionDialog}
		children={childOptions}
		allowMultiple={true}
		onConfirm={handleChildSelectionConfirm}
		onCancel={handleChildSelectionCancel}
		testid="import-child-selection-dialog"
	/>

	<!-- 「他の子供から copy」 dialog -->
	<Dialog
		bind:open={showCopyFromChildDialog}
		title={ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogTitle}
		testid="copy-from-child-dialog"
	>
		<p class="copy-dialog-desc">
			{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogDescPrefix}{CHILD_HONORIFIC_LABEL}{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogDescSuffix}<strong>{selectedChild?.nickname ?? ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogSelectedPlaceholder}</strong>{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogDescCloseParen}
		</p>
		<div class="copy-source-list">
			{#each data.children.filter((c) => c.id !== selectedChildId) as child (child.id)}
				<label class="copy-source-option">
					<input
						type="radio"
						name="copy-source"
						value={child.id}
						checked={copySourceChildId === child.id}
						onchange={() => { copySourceChildId = child.id; }}
						data-testid="copy-source-{child.id}"
					/>
					<span class="copy-source-option__label">
						{child.nickname}
						<span class="copy-source-option__age">({child.age} {ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogAgeSuffix})</span>
						<span class="copy-source-option__count">
							{(data.childActivitiesByChild[child.id] ?? []).length} {ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogCountSuffix}
						</span>
					</span>
				</label>
			{:else}
				<p class="copy-source-empty">{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogEmpty}</p>
			{/each}
		</div>
		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showCopyFromChildDialog = false; copySourceChildId = null; }}>
				{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogCancel}
			</Button>
			<Button
				variant="primary"
				disabled={!copySourceChildId}
				data-testid="copy-from-child-confirm"
				onclick={handleCopyFromChild}
			>
				{ADMIN_ACTIVITIES_PAGE_LABELS.copyDialogConfirm}
			</Button>
		</div>
	</Dialog>

	<!-- 「一括追加」 dialog (新規 activity を複数 child に同時 create) -->
	<!-- Phase 4 簡易版: form + 内蔵 child checkbox list (ChildSelectionDialog の nesting を回避) -->
	<Dialog
		bind:open={showBulkCreateDialog}
		title={ADMIN_ACTIVITIES_PAGE_LABELS.bulkDialogTitle}
		testid="bulk-create-dialog"
	>
		<div class="bulk-form">
			<FormField
				id="bulk-name"
				label={ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormName}
				bind:value={bulkName}
				required={true}
			/>
			<FormField
				id="bulk-points"
				label={ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormPoints}
				type="number"
				bind:value={bulkPoints}
				min={1}
				max={100}
			/>
			<div class="bulk-field">
				<label for="bulk-category" class="bulk-field__label">{ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormCategory}</label>
				<select id="bulk-category" bind:value={bulkCategoryId} class="bulk-select">
					{#each data.categoryDefs as catDef}
						<option value={catDef.id}>{catDef.name}</option>
					{/each}
				</select>
			</div>
			<FormField
				id="bulk-icon"
				label={ADMIN_ACTIVITIES_PAGE_LABELS.bulkFormIcon}
				bind:value={bulkIcon}
			/>
		</div>

		<fieldset class="bulk-targets">
			<legend class="bulk-targets__legend">{ADMIN_ACTIVITIES_PAGE_LABELS.bulkTargetsLegend}</legend>
			<label class="bulk-target-option">
				<input
					type="radio"
					name="bulk-target"
					value="all"
					checked={bulkTargets === 'all'}
					onchange={() => { bulkTargets = 'all'; }}
					data-testid="bulk-target-all"
				/>
				<span>{ADMIN_ACTIVITIES_PAGE_LABELS.bulkTargetAll}</span>
			</label>
			{#each data.children as child (child.id)}
				<label class="bulk-target-option">
					<input
						type="checkbox"
						checked={Array.isArray(bulkTargets) && bulkTargets.includes(child.id)}
						onchange={(e) => {
							const checked = (e.target as HTMLInputElement).checked;
							if (checked) {
								bulkTargets = Array.isArray(bulkTargets)
									? [...bulkTargets, child.id]
									: [child.id];
							} else if (Array.isArray(bulkTargets)) {
								const next = bulkTargets.filter((id) => id !== child.id);
								bulkTargets = next.length === 0 ? 'all' : next;
							}
						}}
						data-testid="bulk-target-{child.id}"
					/>
					<span>{child.nickname} ({child.age} {ADMIN_ACTIVITIES_PAGE_LABELS.bulkTargetChildAgeSuffix})</span>
				</label>
			{/each}
		</fieldset>

		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showBulkCreateDialog = false; }}>
				{ADMIN_ACTIVITIES_PAGE_LABELS.bulkDialogCancel}
			</Button>
			<Button
				variant="primary"
				disabled={!bulkName.trim()}
				data-testid="bulk-create-confirm"
				onclick={() => handleBulkCreate(bulkTargets)}
			>
				{ADMIN_ACTIVITIES_PAGE_LABELS.bulkDialogConfirm}
			</Button>
		</div>
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

	/* #2362 PR-3 Phase 4: child tabs */
	.child-tab-row {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
		align-items: center;
		padding: 0.5rem;
		background: var(--color-surface-muted);
		border-radius: var(--radius-md);
	}
	:global(.child-tab) {
		border-radius: 9999px !important;
		font-size: 0.85rem !important;
	}
	:global(.child-tab--inactive) {
		background: var(--color-surface) !important;
		color: var(--color-text-secondary) !important;
	}
	.child-tab__count {
		font-size: 0.75rem;
		opacity: 0.8;
		margin-left: 0.25rem;
	}
	.child-tab-actions {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}
	.child-context-banner {
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-accent);
		border-left: 3px solid var(--color-border-accent);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.child-context-banner__label {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.child-context-banner__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* per-child activity simple list (Phase 5: list item refactor pending) */
	.per-child-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-sm);
	}
	.per-child-item__icon {
		font-size: 1.25rem;
	}
	.per-child-item__name {
		flex: 1;
		font-weight: 500;
	}
	.per-child-item__points {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.per-child-item__scope-badge {
		font-size: 0.7rem;
		padding: 0.125rem 0.5rem;
		background: var(--color-feedback-info-bg);
		color: var(--color-feedback-info-text);
		border-radius: 9999px;
	}

	/* Copy dialog */
	.copy-dialog-desc {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		margin-bottom: 0.75rem;
	}
	.copy-source-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.copy-source-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.copy-source-option:has(input:checked) {
		background: var(--color-surface-accent);
		border-color: var(--color-border-focus);
	}
	.copy-source-option__label {
		display: flex;
		gap: 0.5rem;
		flex: 1;
	}
	.copy-source-option__age,
	.copy-source-option__count {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	.copy-source-empty {
		text-align: center;
		color: var(--color-text-muted);
		padding: 1rem;
	}
	.copy-dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-light);
	}

	/* Bulk create dialog */
	.bulk-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.bulk-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bulk-field__label {
		font-size: 0.85rem;
		font-weight: 500;
	}
	.bulk-select {
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
	}
	.bulk-targets {
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
		margin-bottom: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bulk-targets__legend {
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0 0.25rem;
	}
	.bulk-target-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem;
		font-size: 0.9rem;
	}
</style>

<script lang="ts">
import { deserialize, enhance } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import {
	ADMIN_CHECKLISTS_PAGE_LABELS,
	APP_LABELS,
	OVERFLOW_MENU_LABELS,
	PAGE_TITLES,
	UI_LABELS,
} from '$lib/domain/labels';
import type { ChecklistPreviewData } from '$lib/features/admin/components/AiSuggestChecklistPanel.svelte';
import AiSuggestChecklistPanel from '$lib/features/admin/components/AiSuggestChecklistPanel.svelte';
// #2391 (Phase 2): 独自 marketplace UI を UnifiedImportHub に統一
import UnifiedImportHub from '$lib/marketplace/ui/UnifiedImportHub.svelte';
import PremiumBadge from '$lib/ui/components/PremiumBadge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import ChildSelectionDialog, {
	type ChildOption,
} from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
// #2778 (Cluster D / User 指摘 #1): 2 並列 Button (+ テンプレート作成 / 📅 ワンオフ追加) を
// `+ 追加` dropdown menu に集約 (admin/activities #2558 段階2 pattern 踏襲、DESIGN.md §10 Hick's Law)。
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
import OverflowMenu, { type OverflowMenuItem } from '$lib/ui/primitives/OverflowMenu.svelte';
import VisibilityChipGroup, {
	type VisibilityChild,
} from '$lib/ui/primitives/VisibilityChipGroup.svelte';

let { data, form } = $props();

let selectedChildId = $state(0);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

// #2362 PR-5 Phase 2 (ADR-0055): family scope の templates 一覧 (childId 軸ではなく family 軸)
//   旧 per-child templates 表示は廃止し、family templates を表示する。
//   override 操作のみ child 軸が残るため selectedChild を維持。
const filteredTemplates = $derived(data.familyTemplates);

// #723: Free プランのテンプレート上限（UI ゲート用、family scope での件数）
// null = 無制限（Standard/Family）
const checklistMax = $derived(data.checklistTemplateMax);
const currentCount = $derived(data.familyTemplates.length);
const atLimit = $derived(checklistMax !== null && currentCount >= checklistMax);

// Add item dialog
let addItemOpen = $state(false);
let addItemTemplateId = $state(0);
let itemName = $state('');
let itemIcon = $state('🏫');
let itemFrequency = $state('daily');
let itemDirection = $state('bring');

// Add template dialog
let addTemplateOpen = $state(false);
let templateName = $state('');
let templateIcon = $state('📋');
let templateTimeSlotValue = $state('anytime');
// #1755 (#1709-A): kind 削除 — 持ち物純化

// Override dialog
let overrideOpen = $state(false);
let overrideDate = $state('');
let overrideAction = $state('add');
let overrideName = $state('');
let overrideIcon = $state('📦');

const FREQUENCY_OPTIONS = [
	{ value: 'daily', label: 'まいにち' },
	{ value: 'weekday:月', label: '月よう' },
	{ value: 'weekday:火', label: '火よう' },
	{ value: 'weekday:水', label: '水よう' },
	{ value: 'weekday:木', label: '木よう' },
	{ value: 'weekday:金', label: '金よう' },
	{ value: 'weekday:土', label: '土よう' },
];

const DIRECTION_OPTIONS = [
	{ value: 'bring', label: '持参' },
	{ value: 'return', label: '持帰' },
	{ value: 'both', label: '往復' },
];

const TIME_SLOT_OPTIONS = [
	{ value: 'anytime', label: 'いつでも', icon: '🕐' },
	{ value: 'morning', label: 'あさ', icon: '☀️' },
	{ value: 'afternoon', label: 'ひる', icon: '🌤️' },
	{ value: 'evening', label: 'よる', icon: '🌙' },
];

const TIME_SLOT_SELECT_OPTIONS = TIME_SLOT_OPTIONS.map((o) => ({
	value: o.value,
	label: `${o.icon} ${o.label}`,
}));

function getTimeSlot(template: { id: number; timeSlot?: string }): string {
	return template.timeSlot ?? 'anytime';
}

function timeSlotLabel(slot: string): string {
	const opt = TIME_SLOT_OPTIONS.find((o) => o.value === slot);
	return opt ? `${opt.icon} ${opt.label}` : slot;
}

const COMMON_ICONS = ['🏫', '👕', '👟', '🎨', '🎵', '📚', '🧹', '🍱', '💧', '📦', '🎒', '✏️'];

// Dialog exclusion: only one dialog open at a time
const anyDialogOpen = $derived(addItemOpen || addTemplateOpen || overrideOpen);

function openAddItem(templateId: number) {
	if (anyDialogOpen) return;
	addItemTemplateId = templateId;
	itemName = '';
	itemIcon = '🏫';
	itemFrequency = 'daily';
	itemDirection = 'bring';
	addItemOpen = true;
}

function openAddTemplate() {
	if (anyDialogOpen) return;
	// #723: Free プランで上限到達時はダイアログを開かない（サーバー側でも 403 で拒否）
	if (atLimit) return;
	templateName = '';
	// #1755 (#1709-A): kind 削除 — 持ち物純化、初期アイコンは持ち物デフォルト 🎒
	templateIcon = '🎒';
	addTemplateOpen = true;
}

function openOverride() {
	if (anyDialogOpen) return;
	overrideDate = data?.today ?? '';
	overrideAction = 'add';
	overrideName = '';
	overrideIcon = '📦';
	overrideOpen = true;
}

function frequencyLabel(freq: string): string {
	const opt = FREQUENCY_OPTIONS.find((o) => o.value === freq);
	return opt?.label ?? freq;
}

function directionLabel(dir: string): string {
	const opt = DIRECTION_OPTIONS.find((o) => o.value === dir);
	return opt?.label ?? dir;
}

// #720: AI提案からテンプレート+アイテムを一括作成
let aiFormEl = $state<HTMLFormElement | null>(null);
let aiTemplateName = $state('');
let aiTemplateIcon = $state('');
let aiItemsJson = $state('');

function acceptAiChecklist(preview: ChecklistPreviewData) {
	aiTemplateName = preview.templateName;
	aiTemplateIcon = preview.templateIcon;
	aiItemsJson = JSON.stringify(preview.items);
	// tick 後にフォーム送信
	requestAnimationFrame(() => {
		aiFormEl?.requestSubmit();
	});
}

// #2391 (Phase 2): marketplace import 完了メッセージ
let marketplaceImportMessage = $state('');

// #2391 (Phase 2): 取込済 presetId 集合 (sourcePresetId から、family scope で確認)
const importedPresetIds = $derived(
	new Set(
		data.familyTemplates.map((t) => t.sourcePresetId).filter((id): id is string => Boolean(id)),
	),
);

// ============================================================
// #2362 PR-5 Phase 2 (ADR-0055): family checklist + 配信先選択 UX
// ============================================================

// ChildSelectionDialog (auto-open `?import=<presetId>` 経由)
let showChildSelectionDialog = $state(false);
let pendingImportPresetId = $state<string | null>(null);
let actionMessage = $state('');

// ChecklistDistributionDialog (template 別の配信先 children 設定)
let showDistributionDialog = $state(false);
let distributionTemplateId = $state<number | null>(null);
let distributionVisibility = $state<Record<number, boolean>>({});

// 「ヘルプ」「復元」「エクスポート」未実装 dialog
let helpDialogOpen = $state(false);
let restoreDialogOpen = $state(false);
let exportDialogOpen = $state(false);

// childOptions for ChildSelectionDialog (PR-2 primitive)
const childSelectionOptions = $derived<ChildOption[]>(
	data.children.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		age: c.age,
		icon: undefined,
	})),
);

// visibility chip 用 children
const visibilityChildren = $derived<VisibilityChild[]>(
	data.children.map((c) => ({
		id: c.id,
		nickname: c.nickname,
		age: c.age,
		icon: undefined,
	})),
);

// `?import=<presetId>` で ChildSelectionDialog auto-open
$effect(() => {
	if (data.importPresetId && !showChildSelectionDialog && pendingImportPresetId === null) {
		pendingImportPresetId = data.importPresetId;
		showChildSelectionDialog = true;
	}
});

// invalid preset の guidance
$effect(() => {
	if (data.importPresetInvalid) {
		actionMessage = ADMIN_CHECKLISTS_PAGE_LABELS.importInvalidPreset;
	}
});

// OverflowMenu items
// #2778 (Cluster D): marketplace は `+ 追加` dropdown menu に統合済 (User 指摘 #1 重複解消)。
// OverflowMenu には restore / export / help の 3 items のみ残す (file 復元 / 設定 / help の意味専用)。
const overflowItems = $derived<OverflowMenuItem[]>([
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.restore.id,
		label: OVERFLOW_MENU_LABELS.items.restore.label,
		icon: OVERFLOW_MENU_LABELS.items.restore.icon,
		onSelect: () => {
			restoreDialogOpen = true;
		},
	},
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.export.id,
		label: OVERFLOW_MENU_LABELS.items.export.label,
		icon: OVERFLOW_MENU_LABELS.items.export.icon,
		onSelect: () => {
			exportDialogOpen = true;
		},
	},
	{ type: 'divider', id: 'divider-1' },
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.help.id,
		label: OVERFLOW_MENU_LABELS.items.help.label,
		icon: OVERFLOW_MENU_LABELS.items.help.icon,
		onSelect: () => {
			helpDialogOpen = true;
		},
	},
]);

// #2778 (Cluster D / User 指摘 #1 / #2558 AC10 横展開): `+ 追加` dropdown menu items
// 旧: 2 並列 Button (`+ テンプレート作成` / `📅 ワンオフ追加`) が常時可視で並列配置されており、
//     初見ユーザーから「ボタンの重複」「マーケットプレイス導線の分裂」と顧客指摘された。
// 新: admin/activities #2558 段階2 pattern を踏襲し、`+ 追加` 単一 primary button + dropdown menu
//     に集約 (DESIGN.md §10 Hick's Law / add 経路 ≤ 4 整合)。
const addMenuItems = $derived<MenuItem[]>([
	{
		id: 'add-template',
		label: ADMIN_CHECKLISTS_PAGE_LABELS.addTemplateMenuLabel,
		icon: ADMIN_CHECKLISTS_PAGE_LABELS.addTemplateMenuIcon,
		onSelect: openAddTemplate,
		disabled: atLimit,
	},
	{
		id: 'add-override',
		label: ADMIN_CHECKLISTS_PAGE_LABELS.addOverrideMenuLabel,
		icon: ADMIN_CHECKLISTS_PAGE_LABELS.addOverrideMenuIcon,
		onSelect: openOverride,
	},
	{
		id: 'browse-marketplace',
		label: ADMIN_CHECKLISTS_PAGE_LABELS.addBrowseTemplatesMenuLabel,
		icon: ADMIN_CHECKLISTS_PAGE_LABELS.addBrowseTemplatesMenuIcon,
		onSelect: () => goto('/marketplace?type=checklist'),
	},
]);

// ChildSelectionDialog confirm: family preset 取込 + 配信先 children 設定
//
// PR-4 reward (#2474 must-2): SvelteKit form action を fetch で直接呼ぶ場合、
// `x-sveltekit-action: true` + `accept: application/json` header が無いと 303 redirect
// が返り JSON parse 失敗する。公式 enhance と同じ header を付与 + `deserialize()` で
// 正しい ActionResult を取得する。
async function handleChildSelectionConfirm(result: 'all' | number[]) {
	if (!pendingImportPresetId) {
		showChildSelectionDialog = false;
		return;
	}
	const childIdsValue = result === 'all' ? 'all' : result.join(',');
	const formData = new FormData();
	formData.append('presetId', pendingImportPresetId);
	formData.append('childIds', childIdsValue);

	try {
		const resp = await fetch('?/importPresetToChildren', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| {
					type: 'success';
					data?: {
						imported?: number;
						skipped?: number;
						total?: number;
						distributedCount?: number;
						packName?: string;
					};
			  }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			// #2558 bug-1: デモ環境 no-op (data.demo === true) は成功偽装せず明示。
			if ((actionResult.data as Record<string, unknown> | undefined)?.demo === true) {
				actionMessage = ADMIN_CHECKLISTS_PAGE_LABELS.importToastDemo;
			} else {
				const packName = actionResult.data?.packName ?? '';
				const distributedCount = Number(actionResult.data?.distributedCount ?? 0);
				const imp = Number(actionResult.data?.imported ?? 0);
				actionMessage =
					imp === 0
						? ADMIN_CHECKLISTS_PAGE_LABELS.importToastDuplicate(packName)
						: ADMIN_CHECKLISTS_PAGE_LABELS.importToastSuccess(packName, distributedCount);
			}
		} else if (actionResult.type === 'failure') {
			actionMessage =
				actionResult.data?.error ??
				ADMIN_CHECKLISTS_PAGE_LABELS.importToastError(pendingImportPresetId);
		} else {
			actionMessage = ADMIN_CHECKLISTS_PAGE_LABELS.importToastError(pendingImportPresetId);
		}
	} catch {
		actionMessage = ADMIN_CHECKLISTS_PAGE_LABELS.importToastError(pendingImportPresetId);
	}

	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	await invalidateAll();

	// URL から ?import=<presetId> を取り除く
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

function handleChildSelectionCancel() {
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

// ChecklistDistributionDialog open: 既存配信先で visibility を初期化
function openDistributionDialog(template: { id: number; assignedChildIds: readonly number[] }) {
	distributionTemplateId = template.id;
	const assignedSet = new Set(template.assignedChildIds);
	const initial: Record<number, boolean> = {};
	for (const c of data.children) {
		initial[c.id] = assignedSet.has(c.id);
	}
	distributionVisibility = initial;
	showDistributionDialog = true;
}

function closeDistributionDialog() {
	showDistributionDialog = false;
	distributionTemplateId = null;
}

function toggleVisibility(childId: number, visible: boolean) {
	distributionVisibility = { ...distributionVisibility, [childId]: visible };
}

async function saveDistribution() {
	if (distributionTemplateId === null) return;
	const desiredChildIds = data.children
		.filter((c) => distributionVisibility[c.id] === true)
		.map((c) => c.id);
	const formData = new FormData();
	formData.append('templateId', String(distributionTemplateId));
	formData.append('childIds', desiredChildIds.length === 0 ? '' : desiredChildIds.join(','));

	try {
		const resp = await fetch('?/syncDistribution', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| { type: 'success'; data?: { added?: number; removed?: number } }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			const added = Number(actionResult.data?.added ?? 0);
			const removed = Number(actionResult.data?.removed ?? 0);
			actionMessage =
				added === 0 && removed === 0
					? ADMIN_CHECKLISTS_PAGE_LABELS.distributionNoChange
					: ADMIN_CHECKLISTS_PAGE_LABELS.distributionUpdated(added, removed);
		} else if (actionResult.type === 'failure') {
			actionMessage = actionResult.data?.error ?? '配信先の保存に失敗しました';
		}
	} catch {
		actionMessage = '配信先の保存に失敗しました';
	}

	closeDistributionDialog();
	await invalidateAll();
}

function getChildName(childId: number): string {
	return data.children.find((c) => c.id === childId)?.nickname ?? `#${childId}`;
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.checklists}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4" data-testid="admin-checklists-page">
	<!-- #2362 PR-5 Phase 2: page header + OverflowMenu (top-right ⋮) -->
	<header class="flex items-start justify-between gap-2">
		<div class="space-y-1 flex-1 min-w-0">
			<h1 class="text-xl font-bold text-[var(--color-text-primary)]">
				{ADMIN_CHECKLISTS_PAGE_LABELS.pageTitle}
			</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				{ADMIN_CHECKLISTS_PAGE_LABELS.familyChecklistsSectionDesc}
			</p>
		</div>
		<OverflowMenu
			items={overflowItems}
			ariaLabel={ADMIN_CHECKLISTS_PAGE_LABELS.overflowMenuAriaLabel}
			testid="checklists-overflow-menu"
		/>
	</header>

	{#if actionMessage}
		<div
			class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)] rounded-xl p-3 text-sm"
			data-testid="checklists-action-message"
		>
			{actionMessage}
		</div>
	{/if}

	<!-- Child selector (override 操作用に残す) -->
	{#if data.children.length > 1}
		<div class="flex gap-2" data-testid="checklists-child-tabs">
			{#each data.children as child (child.id)}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class={selectedChildId === child.id ? '' : 'bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-feedback-info-bg)]'}
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	{/if}

	{#if selectedChild}
		<!-- #1755 (#1709-A): kind タブ削除 — 持ち物純化（旧 'routine' は activities.priority='must' に役割移管） -->

		<!-- #720: AI チェックリスト提案パネル -->
		<AiSuggestChecklistPanel onaccept={acceptAiChecklist} isFamily={data.planTier === 'family'} />

		<!-- #720: AI提案の隠しフォーム -->
		<form
			bind:this={aiFormEl}
			method="POST"
			action="?/createFromAi"
			use:enhance={() => {
				return async () => invalidateAll();
			}}
			class="hidden"
		>
			<input type="hidden" name="childId" value={selectedChildId} />
			<input type="hidden" name="templateName" value={aiTemplateName} />
			<input type="hidden" name="templateIcon" value={aiTemplateIcon} />
			<input type="hidden" name="items" value={aiItemsJson} />
		</form>

		<!-- #2391 (Phase 2): UnifiedImportHub に統一 (旧 #2137 MP-2 独自 UI を置換) -->
		{#if data.marketplaceChecklists.length > 0}
			<Card variant="elevated" padding="lg">
				{#snippet children()}
				<div class="space-y-3" data-testid="marketplace-import-section">
					<div class="flex items-center justify-between">
						<h2 class="text-sm font-bold text-[var(--color-text-primary)]">
							{ADMIN_CHECKLISTS_PAGE_LABELS.marketplaceSectionTitle}
						</h2>
						<a
							href="/marketplace?type=checklist"
							class="text-xs text-[var(--color-action-primary)] hover:underline"
						>
							{ADMIN_CHECKLISTS_PAGE_LABELS.marketplaceSeeMore}
						</a>
					</div>
					{#if marketplaceImportMessage}
						<div
							class="px-3 py-2 rounded-md text-sm bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)]"
							data-testid="marketplace-admin-result-success"
						>
							{marketplaceImportMessage}
						</div>
					{/if}
					<UnifiedImportHub
						typeCode="checklist"
						presets={{
							checklist: data.marketplaceChecklists.map((p) => ({
								itemId: p.itemId,
								name: p.name,
								icon: p.icon,
								itemCount: p.itemCount,
							})),
						}}
						selectedChildId={selectedChildId}
						importedPresetIds={importedPresetIds}
						onimported={(msg) => {
							marketplaceImportMessage = msg;
							invalidateAll();
						}}
					/>
				</div>
				{/snippet}
			</Card>
		{/if}

		<!-- #1755 (#1709-A): kind 削除 — 全テンプレート一覧表示 -->
		{#if filteredTemplates.length === 0}
			<Card variant="elevated" padding="lg">
				{#snippet children()}
				<div class="text-center text-[var(--color-text-tertiary)]">
					<p class="text-3xl mb-2">🎒</p>
					<p>{ADMIN_CHECKLISTS_PAGE_LABELS.emptyChecklistMessage}</p>
				</div>
				{/snippet}
			</Card>
		{/if}

		{#each filteredTemplates as template (template.id)}
			<Card variant="default" padding="none">
				{#snippet children()}
				<!-- Template header -->
				<div class="flex items-center justify-between px-4 py-3 bg-[var(--color-surface-muted)] border-b border-[var(--color-border-light)]">
					<div class="flex items-center gap-2">
						<span class="text-xl">{template.icon}</span>
						<span class="font-bold text-[var(--color-text-primary)]">{template.name}</span>
						<span class="text-xs px-2 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded">{timeSlotLabel(getTimeSlot(template))}</span>
						{#if !template.isActive}
							<span class="text-xs px-2 py-0.5 bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] rounded">{ADMIN_CHECKLISTS_PAGE_LABELS.inactiveBadge}</span>
						{/if}
					</div>
					<div class="flex items-center gap-1">
						<form method="POST" action="?/toggleTemplate" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<input type="hidden" name="isActive" value={template.isActive} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]"
								title={template.isActive ? '無効にする' : '有効にする'}
							>
								{template.isActive ? '無効化' : '有効化'}
							</Button>
						</form>
						<form method="POST" action="?/deleteTemplate" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="bg-[var(--color-feedback-error-bg)] hover:bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]"
								onclick={(e) => { if (!confirm('削除しますか？')) e.preventDefault(); }}
							>
								{ADMIN_CHECKLISTS_PAGE_LABELS.deleteButton}
							</Button>
						</form>
					</div>
				</div>

				<!-- Time slot selector -->
				<div class="flex items-center gap-1 px-4 py-2 bg-white border-b border-[var(--color-surface-muted)]">
					<span class="text-xs text-[var(--color-text-muted)] mr-1">{ADMIN_CHECKLISTS_PAGE_LABELS.timeSlotLabel}</span>
					{#each TIME_SLOT_OPTIONS as opt}
						<form method="POST" action="?/updateTimeSlot" use:enhance={() => async () => invalidateAll()}>
							<input type="hidden" name="templateId" value={template.id} />
							<input type="hidden" name="timeSlot" value={opt.value} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="text-xs px-2 py-1 {getTimeSlot(template) === opt.value ? 'bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-feedback-info-text)] ring-1 ring-[var(--color-feedback-info-border)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)]'}"
							>
								{opt.icon} {opt.label}
							</Button>
						</form>
					{/each}
				</div>

				<!-- Items list -->
				<div class="divide-y divide-gray-50">
					{#each template.items as item (item.id)}
						<div class="flex items-center justify-between px-4 py-2">
							<div class="flex items-center gap-2">
								<span>{item.icon}</span>
								<span class="text-sm font-medium">{item.name}</span>
								<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] rounded">{frequencyLabel(item.frequency)}</span>
								<span class="text-xs px-1.5 py-0.5 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] rounded">{directionLabel(item.direction)}</span>
							</div>
							<form method="POST" action="?/removeItem" use:enhance={() => async () => invalidateAll()}>
								<input type="hidden" name="itemId" value={item.id} />
								<Button
									type="submit"
									variant="ghost"
									size="sm"
									class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-feedback-error-text)] px-1"
									title={ADMIN_CHECKLISTS_PAGE_LABELS.deleteButton}
								>
									✕
								</Button>
							</form>
						</div>
					{/each}
				</div>

				<!-- Add item button -->
				<div class="px-4 py-2 border-t border-[var(--color-surface-muted)]">
					<Button
						variant="ghost"
						size="sm"
						class="w-full py-2 text-sm text-[var(--color-feedback-info-text)] hover:bg-[var(--color-feedback-info-bg)]"
						onclick={() => openAddItem(template.id)}
					>
						{ADMIN_CHECKLISTS_PAGE_LABELS.addItemButton}
					</Button>
				</div>

				<!-- #2362 PR-5 Phase 2: 配信先 + per-child progress section -->
				<div
					class="px-4 py-3 border-t border-[var(--color-surface-muted)] bg-[var(--color-surface-muted)]"
					data-testid="checklist-distribution-section-{template.id}"
				>
					<div class="flex items-center justify-between mb-2">
						<h3 class="text-xs font-bold text-[var(--color-text-secondary)]">
							{ADMIN_CHECKLISTS_PAGE_LABELS.distributionSectionTitle}
						</h3>
						<Button
							variant="ghost"
							size="sm"
							class="text-xs text-[var(--color-action-primary)] hover:bg-[var(--color-feedback-info-bg)]"
							onclick={() => openDistributionDialog(template)}
							data-testid="checklist-configure-distribution-{template.id}"
						>
							{ADMIN_CHECKLISTS_PAGE_LABELS.distributionConfigureButton}
						</Button>
					</div>
					{#if template.assignedChildIds.length === 0}
						<p class="text-xs text-[var(--color-text-tertiary)]">
							{ADMIN_CHECKLISTS_PAGE_LABELS.distributionEmpty}
						</p>
					{:else}
						<ul class="space-y-1" data-testid="checklist-per-child-progress-{template.id}">
							{#each template.perChildProgress as p (p.childId)}
								<li
									class="flex items-center justify-between text-xs px-2 py-1 rounded bg-white"
									data-testid="checklist-progress-{template.id}-{p.childId}"
								>
									<span class="text-[var(--color-text-primary)]">
										{getChildName(p.childId)}
									</span>
									<span
										class="text-[var(--color-text-secondary)] {p.completedAll
											? 'text-[var(--color-feedback-success-text)] font-bold'
											: ''}"
									>
										{p.checkedCount} / {p.totalCount}
										{#if p.completedAll}✅{/if}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				{/snippet}
			</Card>
		{/each}

		<!-- #723: Free プランで上限到達時のアップグレード誘導 -->
		{#if !data.isPremium && checklistMax !== null}
			<div class="px-4 py-3 rounded-lg bg-[var(--color-surface-trial)] border border-[var(--color-border-trial)] text-sm">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="text-base">📋</span>
						<span class="text-[var(--color-text-primary)]">
							{#if atLimit}
								{ADMIN_CHECKLISTS_PAGE_LABELS.limitReachedText(checklistMax)}
							{:else}
								{ADMIN_CHECKLISTS_PAGE_LABELS.limitCountText(currentCount, checklistMax)}
							{/if}
						</span>
					</div>
					<a
						href="/pricing"
						class="text-xs font-bold text-[var(--color-action-primary)] hover:underline"
					>
						{ADMIN_CHECKLISTS_PAGE_LABELS.upgradeLink}
					</a>
				</div>
				{#if atLimit}
					<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
						{ADMIN_CHECKLISTS_PAGE_LABELS.upgradeDesc}
					</p>
				{/if}
			</div>
		{/if}

		<!-- Actions (#2778 / Cluster D): 2 並列 Button を `+ 追加` dropdown menu に集約 -->
		<div class="checklist-actions">
			<Menu
				items={addMenuItems}
				placement="bottom-end"
				ariaLabel={ADMIN_CHECKLISTS_PAGE_LABELS.addMenuAriaLabel}
				testid="checklists-add-menu-trigger"
				triggerClass="checklist-add-btn"
				triggerLabel={ADMIN_CHECKLISTS_PAGE_LABELS.addButtonLabel}
				disabled={atLimit}
			/>
			{#if !data.isPremium}
				<PremiumBadge size="sm" label={ADMIN_CHECKLISTS_PAGE_LABELS.premiumBadgeLabel} />
			{/if}
		</div>

		<!-- Today's overrides -->
		{#if selectedChild.overrides.length > 0}
			<Card variant="default" padding="none">
				{#snippet children()}
				<div class="px-4 py-3 bg-[var(--color-feedback-warning-bg)] border-b border-[var(--color-feedback-warning-bg-strong)]">
					<span class="font-bold text-[var(--color-text-primary)]">{ADMIN_CHECKLISTS_PAGE_LABELS.todayOverrideTitle}</span>
				</div>
				<div class="divide-y divide-gray-50">
					{#each selectedChild.overrides as ov (ov.id)}
						<div class="flex items-center justify-between px-4 py-2">
							<div class="flex items-center gap-2">
								<span>{ov.icon}</span>
								<span class="text-sm">{ov.itemName}</span>
								<span class="text-xs px-1.5 py-0.5 {ov.action === 'add' ? 'bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)]' : 'bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)]'} rounded">
									{ov.action === 'add' ? '追加' : '除外'}
								</span>
							</div>
							<form method="POST" action="?/removeOverride" use:enhance={() => async () => invalidateAll()}>
								<input type="hidden" name="overrideId" value={ov.id} />
								<Button type="submit" variant="ghost" size="sm" class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-feedback-error-text)] px-1" title={ADMIN_CHECKLISTS_PAGE_LABELS.deleteButton} aria-label={ADMIN_CHECKLISTS_PAGE_LABELS.deleteButton}>✕</Button>
							</form>
						</div>
					{/each}
				</div>
				{/snippet}
			</Card>
		{/if}
	{/if}
</div>

<!-- Add template dialog -->
<Dialog bind:open={addTemplateOpen} closable={true} title={ADMIN_CHECKLISTS_PAGE_LABELS.addTemplateDialogTitle}>
	<form
		method="POST"
		action="?/createTemplate"
		use:enhance={() => {
			addTemplateOpen = false;
			return async () => invalidateAll();
		}}
		class="space-y-4"
	>
		<input type="hidden" name="childId" value={selectedChildId} />

		<!-- #1755 (#1709-A): kind 選択削除 — 持ち物純化 -->

		<FormField label="名前" type="text" name="name" bind:value={templateName} placeholder={ADMIN_CHECKLISTS_PAGE_LABELS.namePlaceholderItem} required />

		<div>
			<span class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{ADMIN_CHECKLISTS_PAGE_LABELS.formIconLabel}</span>
			<div class="flex gap-1 flex-wrap">
				{#each ['📋', '🎒', '🏫', '📚'] as ic}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="w-10 h-10 text-xl {templateIcon === ic ? 'ring-2 ring-[var(--color-border-focus)] bg-[var(--color-feedback-info-bg)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-secondary)]'}"
						onclick={() => (templateIcon = ic)}
					>{ic}</Button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={templateIcon} />
		</div>

		<FormField label="時間帯">
			{#snippet children()}
				<NativeSelect
					name="timeSlot"
					bind:value={templateTimeSlotValue}
					options={TIME_SLOT_SELECT_OPTIONS}
				/>
			{/snippet}
		</FormField>

		<Button
			type="submit"
			variant="primary"
			size="md"
			class="w-full"
		>
			{ADMIN_CHECKLISTS_PAGE_LABELS.createButton}
		</Button>
	</form>
</Dialog>

<!-- Add item dialog -->
<Dialog bind:open={addItemOpen} closable={true} title={ADMIN_CHECKLISTS_PAGE_LABELS.addItemDialogTitle}>
	<form
		method="POST"
		action="?/addItem"
		use:enhance={() => {
			addItemOpen = false;
			return async () => invalidateAll();
		}}
		class="space-y-4"
	>
		<input type="hidden" name="templateId" value={addItemTemplateId} />

		<FormField label="名前" type="text" name="name" bind:value={itemName} placeholder="例: ハンカチ" required />

		<div>
			<span class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{ADMIN_CHECKLISTS_PAGE_LABELS.formIconLabel}</span>
			<div class="flex gap-1 flex-wrap">
				{#each COMMON_ICONS as ic}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="w-10 h-10 text-xl {itemIcon === ic ? 'ring-2 ring-[var(--color-border-focus)] bg-[var(--color-feedback-info-bg)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-secondary)]'}"
						onclick={() => (itemIcon = ic)}
					>{ic}</Button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={itemIcon} />
		</div>

		<FormField label="頻度">
			{#snippet children()}
				<NativeSelect name="frequency" bind:value={itemFrequency} options={FREQUENCY_OPTIONS} />
			{/snippet}
		</FormField>

		<FormField label="方向">
			{#snippet children()}
				<NativeSelect name="direction" bind:value={itemDirection} options={DIRECTION_OPTIONS} />
			{/snippet}
		</FormField>

		<Button
			type="submit"
			variant="primary"
			size="md"
			class="w-full"
		>
			{ADMIN_CHECKLISTS_PAGE_LABELS.addButton}
		</Button>
	</form>
</Dialog>

<!-- Override dialog -->
<Dialog bind:open={overrideOpen} closable={true} title={ADMIN_CHECKLISTS_PAGE_LABELS.overrideDialogTitle}>
	<form
		method="POST"
		action="?/addOverride"
		use:enhance={() => {
			overrideOpen = false;
			return async () => invalidateAll();
		}}
		class="space-y-4"
	>
		<input type="hidden" name="childId" value={selectedChildId} />

		<FormField label="日付" type="date" name="targetDate" bind:value={overrideDate} required />

		<FormField label="操作">
			{#snippet children()}
				<NativeSelect
					name="action"
					bind:value={overrideAction}
					options={[
						{ value: 'add', label: '追加' },
						{ value: 'remove', label: '除外' },
					]}
				/>
			{/snippet}
		</FormField>

		<FormField label="アイテム名" type="text" name="itemName" bind:value={overrideName} placeholder="例: リュック（遠足）" required />

		<div>
			<span class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{ADMIN_CHECKLISTS_PAGE_LABELS.formIconLabel}</span>
			<div class="flex gap-1 flex-wrap">
				{#each COMMON_ICONS as ic}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="w-10 h-10 text-xl {overrideIcon === ic ? 'ring-2 ring-[var(--color-border-focus)] bg-[var(--color-feedback-info-bg)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-secondary)]'}"
						onclick={() => (overrideIcon = ic)}
					>{ic}</Button>
				{/each}
			</div>
			<input type="hidden" name="icon" value={overrideIcon} />
		</div>

		<Button
			type="submit"
			variant="primary"
			size="md"
			class="w-full"
		>
			{ADMIN_CHECKLISTS_PAGE_LABELS.addButton}
		</Button>
	</form>
</Dialog>

<!-- #2362 PR-5 Phase 2: ChildSelectionDialog (auto-open via `?import=<presetId>`) -->
<ChildSelectionDialog
	children={childSelectionOptions}
	bind:open={showChildSelectionDialog}
	allowMultiple={true}
	onConfirm={handleChildSelectionConfirm}
	onCancel={handleChildSelectionCancel}
	testid="checklist-import-child-selection-dialog"
/>

<!-- #2362 PR-5 Phase 2: ChecklistDistributionDialog (per-template 配信先設定) -->
<Dialog
	bind:open={showDistributionDialog}
	closable={true}
	title={ADMIN_CHECKLISTS_PAGE_LABELS.distributionDialogTitle}
	testid="checklist-distribution-dialog"
>
	<div class="space-y-3">
		<p class="text-sm text-[var(--color-text-secondary)]">
			{ADMIN_CHECKLISTS_PAGE_LABELS.distributionDialogDesc}
		</p>
		<VisibilityChipGroup
			children={visibilityChildren}
			visibility={distributionVisibility}
			onToggle={toggleVisibility}
			testid="checklist-distribution-visibility"
		/>
		<div class="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-light)]">
			<Button variant="ghost" onclick={closeDistributionDialog}>{UI_LABELS.cancel}</Button>
			<Button
				variant="primary"
				onclick={saveDistribution}
				data-testid="checklist-distribution-save"
			>
				{ADMIN_CHECKLISTS_PAGE_LABELS.distributionSaveButton}
			</Button>
		</div>
	</div>
</Dialog>

<!-- #2362 PR-5 Phase 2: OverflowMenu の未実装機能告知 + Help dialog 群 -->
<Dialog bind:open={helpDialogOpen} closable={true} title={ADMIN_CHECKLISTS_PAGE_LABELS.helpDialogTitle}>
	<p class="text-sm text-[var(--color-text-secondary)]">
		{ADMIN_CHECKLISTS_PAGE_LABELS.helpDialogDesc}
	</p>
</Dialog>
<Dialog bind:open={restoreDialogOpen} closable={true} title={ADMIN_CHECKLISTS_PAGE_LABELS.restoreNotImplementedTitle}>
	<p class="text-sm text-[var(--color-text-secondary)]">
		{ADMIN_CHECKLISTS_PAGE_LABELS.restoreNotImplementedDesc}
	</p>
</Dialog>
<Dialog bind:open={exportDialogOpen} closable={true} title={ADMIN_CHECKLISTS_PAGE_LABELS.exportNotImplementedTitle}>
	<p class="text-sm text-[var(--color-text-secondary)]">
		{ADMIN_CHECKLISTS_PAGE_LABELS.exportNotImplementedDesc}
	</p>
</Dialog>

<style>
	/* #2778 (Cluster D / User feedback #1): `+ Add` dropdown menu trigger button styling.
	 * Aligned with admin/activities .add-btn pattern (FEATURES_LABELS.activitiesHeader / ActivitiesHeader.svelte). */
	.checklist-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* #2260 Fix-1 pattern: Menu primitive pass-through requires :global selector for parent scope visibility */
	:global(.checklist-actions .checklist-add-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		font-size: 0.9375rem;
		font-weight: 700;
		cursor: pointer;
		transition: filter 0.15s;
		flex: 1;
	}
	:global(.checklist-actions .checklist-add-btn:hover:not(:disabled)) {
		filter: brightness(0.9);
	}
	:global(.checklist-actions .checklist-add-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>

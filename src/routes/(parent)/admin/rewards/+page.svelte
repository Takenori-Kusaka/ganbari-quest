<script lang="ts">
// /admin/rewards — ごほうび管理 (#2362 PR-4: per-child UX 整備、ADR-0055)
//
// PR-4 (2026-05-25):
// - 子供別タブ切替 (PR-3 ADMIN_ACTIVITIES_PAGE_LABELS 同型)
// - ChildSelectionDialog auto-open (`?import=<presetId>` 経由)
// - 「他の子供から copy」action (兄弟共通化 UX、User §3 reward use case R6)
// - marketplace 取込フロー: child 情報を URL/body に露出させない (CWE-598 / User §7.3)
//
// 既存 (#2268): CRUD + 命名訂正 + 検索 + grant→add リネーム + 申請タブ削除

import { deserialize, enhance } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import { getErrorMessage } from '$lib/domain/errors';
import {
	ADMIN_REWARDS_PAGE_LABELS,
	APP_LABELS,
	PAGE_TITLES,
	REWARDS_LABELS,
} from '$lib/domain/labels';
import { CHILD_TERMS } from '$lib/domain/terms';
import type { RewardPreviewData } from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import ChildSelectionDialog, {
	type ChildOption,
} from '$lib/ui/primitives/ChildSelectionDialog.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

// #2362 PR-4: hardcoded text 排除 (ADR-0045) — CHILD_TERMS.honorific を template literal で参照
const CHILD_HONORIFIC_LABEL = CHILD_TERMS.honorific;

let { data, form } = $props();
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

// #2362 PR-4: 子供タブ切替 UI
//   `?childId=<n>` query で初期 child 復元、未指定なら最初の child
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

// 選択中 child の per-child reward 一覧
const perChildRewards = $derived(
	selectedChildId ? (data.childRewardsByChild[selectedChildId] ?? []) : [],
);

// #2362 PR-4: ChildSelectionDialog state (per-child 取込時 auto-open)
let showChildSelectionDialog = $state(false);
let pendingImportPresetId = $state<string | null>(null);
let actionMessage = $state('');

// #2362 PR-4: 「他の子供から copy」dialog
let showCopyFromChildDialog = $state(false);
let copySourceChildId = $state<number | null>(null);

// `?import=<presetId>` で auto-open (server load で validation 済)
$effect(() => {
	if (data.importPresetId && !showChildSelectionDialog) {
		pendingImportPresetId = data.importPresetId;
		showChildSelectionDialog = true;
	}
});

// #2362 PR-4: 取込失敗 / invalid preset の guidance
$effect(() => {
	if (data.importPresetInvalid) {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.importInvalidPreset;
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

// #2268: 検索 UI 状態
let searchQuery = $state('');

// --- ごほうび追加フォーム ---
let selectedTemplate = $state<{
	title: string;
	points: number;
	icon: string;
	category: string;
} | null>(null);
let customTitle = $state('');
let customPoints = $state(100);
let customIcon = $state('🎁');
let customCategory = $state('とくべつ');
let grantSuccess = $state(false);
let showPresets = $state(false);

function selectTemplate(tmpl: { title: string; points: number; icon?: string; category: string }) {
	selectedTemplate = { ...tmpl, icon: tmpl.icon ?? '🎁' };
	customTitle = tmpl.title;
	customPoints = tmpl.points;
	customIcon = tmpl.icon ?? '🎁';
	customCategory = tmpl.category;
}

const categoryLabels: Record<string, string> = {
	うんどう: 'うんどう',
	べんきょう: 'べんきょう',
	せいかつ: 'せいかつ',
	こうりゅう: 'こうりゅう',
	そうぞう: 'そうぞう',
	とくべつ: 'とくべつ',
};

/** AI提案からカテゴリをフォームのカテゴリラベルにマッピング */
const rewardGroupToCategory: Record<string, string> = {
	もの: 'とくべつ',
	たいけん: 'こうりゅう',
	おこづかい: 'とくべつ',
	とくべつ: 'とくべつ',
};

function acceptAiReward(preview: RewardPreviewData) {
	customTitle = preview.title;
	customPoints = preview.points;
	customIcon = preview.icon;
	customCategory = rewardGroupToCategory[preview.category] ?? preview.category;
	selectedTemplate = {
		title: preview.title,
		points: preview.points,
		icon: preview.icon,
		category: customCategory,
	};
}

// #2268: 検索 filter (テンプレ + プリセット両方に適用)
const filteredTemplates = $derived(
	searchQuery.trim()
		? data.templates.filter((t) => t.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
		: data.templates,
);
const hasSearchActive = $derived(searchQuery.trim().length > 0);
const allEmpty = $derived(
	hasSearchActive &&
		filteredTemplates.length === 0 &&
		data.presetGroups.every(
			(g) =>
				g.rewards.filter((r) => r.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
					.length === 0,
		),
);

// #2268: overflow menu (申請承認等)
const overflowMenuItems = $derived<MenuItem[]>([
	{
		id: 'requests',
		label:
			data.pendingRequestsCount > 0
				? REWARDS_LABELS.requestsMenuLabel(data.pendingRequestsCount)
				: REWARDS_LABELS.requestsMenuLabelEmpty,
		icon: '📋',
		onSelect: () => goto('/admin/rewards/requests'),
	},
]);

// #2362 PR-4: 子供タブクリック時に URL を `?childId=<n>` に同期 (share link / refresh 対応)
function selectChild(childId: number) {
	childIdOverride = childId;
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.set('childId', String(childId));
		// import param は dialog auto-open でしか使わないので消す (戻ったとき再 open しない)
		url.searchParams.delete('import');
		window.history.replaceState({}, '', url.toString());
	}
}

// #2362 PR-4: ChildSelectionDialog 確定ハンドラ: 'all' or number[] (選択 child IDs)
//
// #2474 must-2 (Copilot must-1): SvelteKit form action を fetch で直接呼ぶ場合、
// `x-sveltekit-action: true` + `accept: application/json` header が無いと 303 redirect
// が返ってきて JSON parse 常時 fail し件数が誤表示される (件数=1 固定の旧 bug)。
// 公式 enhance と同じ header を付与 + `deserialize()` で正しい ActionResult を取得する。
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
		// SvelteKit returns the serialized ActionResult as text for AJAX requests
		// when x-sveltekit-action header is set. Use `deserialize()` to parse correctly.
		const actionResult = deserialize(await resp.text()) as
			| {
					type: 'success';
					data?: { imported?: number; skipped?: number; total?: number };
			  }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			// #2558 bug-1: デモ環境 no-op (data.demo === true) は成功偽装せず明示。
			if ((actionResult.data as Record<string, unknown> | undefined)?.demo === true) {
				actionMessage = ADMIN_REWARDS_PAGE_LABELS.importDemo;
			} else {
				const imp = Number(actionResult.data?.imported ?? 0);
				actionMessage =
					imp === 0
						? ADMIN_REWARDS_PAGE_LABELS.importAllDuplicates
						: ADMIN_REWARDS_PAGE_LABELS.importSuccess(imp);
				await invalidateAll();
			}
		} else if (actionResult.type === 'failure') {
			actionMessage = String(actionResult.data?.error ?? ADMIN_REWARDS_PAGE_LABELS.importFailed);
		} else {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.importFailed;
		}
	} catch {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.importFailed;
	}
	pendingImportPresetId = null;
	showChildSelectionDialog = false;
	// URL から import param を除去 (戻り遷移時に再 open しない)
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

// #2362 PR-4: 「他の子供から copy」action
//
// #2474 must-2 (Copilot must-2): handleChildSelectionConfirm と同じ理由で
// `x-sveltekit-action: true` + `accept: application/json` header + `deserialize()`
// により copiedCount を実値で取得する (旧 bug: 件数=0 固定誤表示)。
async function handleCopyFromChild() {
	if (!copySourceChildId || !selectedChildId || copySourceChildId === selectedChildId) {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.copySameChild;
		return;
	}
	const formData = new FormData();
	formData.append('sourceChildId', String(copySourceChildId));
	formData.append('targetChildId', String(selectedChildId));

	try {
		const resp = await fetch('?/copyFromChild', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
			body: formData,
		});
		const actionResult = deserialize(await resp.text()) as
			| { type: 'success'; data?: { copiedCount?: number } }
			| { type: 'failure'; data?: { error?: string } }
			| { type: 'redirect'; location: string }
			| { type: 'error'; error: unknown };

		if (actionResult.type === 'success') {
			const cnt = Number(actionResult.data?.copiedCount ?? 0);
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.copySuccess(cnt);
			showCopyFromChildDialog = false;
			copySourceChildId = null;
			await invalidateAll();
		} else if (actionResult.type === 'failure') {
			actionMessage = String(actionResult.data?.error ?? ADMIN_REWARDS_PAGE_LABELS.copyFailed);
		} else {
			actionMessage = ADMIN_REWARDS_PAGE_LABELS.copyFailed;
		}
	} catch {
		actionMessage = ADMIN_REWARDS_PAGE_LABELS.copyFailed;
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.rewards}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-4" data-tutorial="rewards-section">
	<div class="flex items-center gap-2">
		<h2 class="text-lg font-bold">{REWARDS_LABELS.sectionTitle}
			{#if !data.isPremium}
				<span class="ml-1 inline-block px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)] align-middle">{REWARDS_LABELS.premiumBadge}</span>
			{/if}
		</h2>
		<!-- #2268: 申請承認バッジ + overflow menu に振替 (旧: タブで併存) -->
		<div class="ml-auto flex items-center gap-2">
			{#if data.pendingRequestsCount > 0}
				<span class="inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full bg-[var(--color-action-danger)] text-white" data-testid="pending-badge">
					{data.pendingRequestsCount}
				</span>
			{/if}
			<Menu
				items={overflowMenuItems}
				ariaLabel={REWARDS_LABELS.overflowMenuAriaLabel}
				testid="rewards-overflow-menu"
				triggerLabel="︙"
			/>
		</div>
	</div>

	<!-- Page Description -->
	<div class="page-description">
		<p class="page-description__title">{REWARDS_LABELS.pageDescTitle}</p>
		<p class="page-description__text">
			{REWARDS_LABELS.pageDescText1}
			{REWARDS_LABELS.pageDescText2}
		</p>
		<p class="page-description__hint">
			{REWARDS_LABELS.pageDescHintPrefix}
			<a href="/admin/messages" class="page-description__link">{REWARDS_LABELS.pageDescHintLink}</a>
			{REWARDS_LABELS.pageDescHintSuffix}
		</p>
	</div>

	{#if !data.isPremium}
		<!-- #728: 無料プラン向けアップグレード誘導 -->
		<div class="bg-[var(--color-premium-bg)] rounded-xl p-4 space-y-3 border border-[var(--color-border-premium)]" data-testid="rewards-upgrade-banner">
			<div class="flex items-start gap-3">
				<span class="text-2xl">✨</span>
				<div class="flex-1">
					<p class="font-bold text-[var(--color-premium)]">{REWARDS_LABELS.upgradeBannerTitle}</p>
					<p class="text-xs text-[var(--color-premium-light)] mt-1">
						{REWARDS_LABELS.upgradeBannerDesc}
					</p>
				</div>
			</div>
			<a
				href="/admin/license"
				class="inline-block px-3 py-1.5 bg-[var(--color-premium)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors"
				data-testid="rewards-upgrade-cta"
			>
				{REWARDS_LABELS.upgradeButton}
			</a>
		</div>
	{/if}

	<!-- #2362 PR-4: 子供タブ切替 UI -->
	{#if data.children.length > 0}
		<div
			class="child-tab-row"
			data-testid="admin-rewards-child-tabs"
			role="tablist"
			aria-label={ADMIN_REWARDS_PAGE_LABELS.childTabsAriaLabel}
		>
			{#each data.children as child (child.id)}
				{@const count = (data.childRewardsByChild[child.id] ?? []).length}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="child-tab {selectedChildId === child.id ? '' : 'child-tab--inactive'}"
					data-testid="rewards-child-tab-{child.id}"
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
						data-testid="rewards-copy-from-child-btn"
						disabled={!data.isPremium}
						onclick={() => { showCopyFromChildDialog = true; }}
					>
						{ADMIN_REWARDS_PAGE_LABELS.copyFromChildButton}
					</Button>
				{/if}
			</div>
		</div>

		{#if selectedChild}
			<div class="child-context-banner" data-testid="rewards-child-context-banner">
				<span class="child-context-banner__label">
					{selectedChild.nickname}{ADMIN_REWARDS_PAGE_LABELS.childContextRewardsSuffix(perChildRewards.length)}
				</span>
				<span class="child-context-banner__hint">
					{ADMIN_REWARDS_PAGE_LABELS.childContextHint}
				</span>
			</div>
		{/if}
	{/if}

	<!-- #2268: 検索 UI -->
	<section>
		<FormField
			label={REWARDS_LABELS.searchLabel}
			type="search"
			bind:value={searchQuery}
			placeholder={REWARDS_LABELS.searchPlaceholder}
		/>
	</section>

	<!-- アクションメッセージ (取込結果 / copy 結果 / invalid preset 警告) -->
	{#if actionMessage}
		<div
			class="action-message"
			data-testid="rewards-action-message"
		>
			{actionMessage}
		</div>
	{/if}

	<!-- Error Display -->
	{#if errorMessage}
		<div class="bg-[color-mix(in_srgb,var(--color-action-danger)_10%,transparent)] rounded-xl p-3 border border-[color-mix(in_srgb,var(--color-action-danger)_30%,transparent)] text-[var(--color-action-danger)] text-sm">
			{errorMessage}
		</div>
	{/if}

	<!-- AI Suggest Reward Panel (#719) -->
	<AiSuggestRewardPanel onaccept={acceptAiReward} isFamily={data.planTier === 'family'} />

	<!-- #2268: 検索結果 0 件メッセージ -->
	{#if allEmpty}
		<div class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)] rounded-xl p-3 text-sm text-center" data-testid="rewards-search-empty">
			{REWARDS_LABELS.searchEmptyMessage}
		</div>
	{/if}

	<!-- ごほうび一覧 (旧: テンプレートを選択 → プリセットを選択) -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{REWARDS_LABELS.selectTemplateTitle}</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
			{#each filteredTemplates as tmpl}
				<Button
					variant="ghost"
					size="sm"
					disabled={!data.isPremium}
					class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm text-center hover:shadow-md flex-col h-auto
						{selectedTemplate?.title === tmpl.title ? 'ring-2 ring-[var(--color-action-primary)]' : ''}"
					onclick={() => selectTemplate(tmpl)}
				>
					<span class="text-2xl block">{tmpl.icon ?? '🎁'}</span>
					<p class="text-xs font-bold text-[var(--color-text-muted)] mt-1">{tmpl.title}</p>
					<p class="text-xs text-[var(--color-point)] font-bold">{tmpl.points}P</p>
				</Button>
			{/each}
		</div>
	</section>

	<!-- Preset Catalog -->
	<section>
		<button
			type="button"
			class="text-sm font-bold text-[var(--color-text-link)] cursor-pointer bg-transparent border-none p-0 hover:underline"
			onclick={() => { showPresets = !showPresets; }}
		>
			{REWARDS_LABELS.presetToggle(showPresets)}
		</button>

		{#if showPresets}
			<div class="mt-2 space-y-3">
				{#each data.presetGroups as group}
					{@const filteredRewards = hasSearchActive
						? group.rewards.filter((r) =>
								r.title.toLowerCase().includes(searchQuery.trim().toLowerCase()),
							)
						: group.rewards}
					{#if filteredRewards.length > 0}
						<div>
							<p class="text-xs font-bold text-[var(--color-text-muted)] mb-1">{group.groupIcon} {group.groupName}</p>
							<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
								{#each filteredRewards as preset}
									<form method="POST" action="?/addPreset" use:enhance={() => {
										return async ({ update }) => { await update(); };
									}}>
										<input type="hidden" name="title" value={preset.title} />
										<input type="hidden" name="points" value={preset.points} />
										<input type="hidden" name="icon" value={preset.icon} />
										<input type="hidden" name="category" value={preset.category} />
										<Button
											type="submit"
											variant="ghost"
											size="sm"
											disabled={!data.isPremium}
											class="w-full bg-[var(--color-surface-card)] rounded-xl p-2 shadow-sm text-center hover:shadow-md flex-col h-auto"
										>
											<span class="text-xl block">{preset.icon}</span>
											<p class="text-xs font-bold text-[var(--color-text-muted)] mt-0.5">{preset.title}</p>
											<p class="text-xs text-[var(--color-point)] font-bold">{preset.points}P</p>
										</Button>
									</form>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</section>

	<!-- Add Form (旧: Grant Form、#2268 リネーム) -->
	<Card variant="elevated" padding="md">
		{#snippet children()}
		<form
			method="POST"
			action="?/add"
			use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success' && result.data && 'granted' in result.data) {
						grantSuccess = true;
						setTimeout(() => { grantSuccess = false; }, 3000);
					}
					await update();
				};
			}}
			class="space-y-3"
		>
			<h3 class="text-sm font-bold text-[var(--color-text-muted)]">{REWARDS_LABELS.confirmGrantTitle}</h3>
			<input type="hidden" name="childId" value={selectedChildId} />

			<div class="grid grid-cols-2 gap-3">
				<FormField label={REWARDS_LABELS.titleLabel} type="text" name="title" bind:value={customTitle} disabled={!data.isPremium} required />
				<FormField label={REWARDS_LABELS.pointsLabel} type="number" name="points" bind:value={customPoints} min={1} max={10000} disabled={!data.isPremium} required />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<FormField label={REWARDS_LABELS.iconLabel} type="text" name="icon" bind:value={customIcon} disabled={!data.isPremium} />
				<FormField label={REWARDS_LABELS.categoryLabel}>
					{#snippet children()}
						<NativeSelect
							name="category"
							bind:value={customCategory}
							disabled={!data.isPremium}
							options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
						/>
					{/snippet}
				</FormField>
			</div>

			<Button
				type="submit"
				variant="primary"
				size="md"
				disabled={!data.isPremium}
				class="w-full"
			>
				{REWARDS_LABELS.grantButton(customIcon, customTitle, customPoints)}
			</Button>
		</form>
		{/snippet}
	</Card>

	{#if grantSuccess}
		<div class="bg-[color-mix(in_srgb,var(--color-action-success)_10%,transparent)] rounded-xl p-4 border border-[color-mix(in_srgb,var(--color-action-success)_30%,transparent)] text-center">
			<p class="text-[var(--color-action-success)] font-bold">{REWARDS_LABELS.grantSuccess}</p>
		</div>
	{/if}

	<!-- #2362 PR-4: ChildSelectionDialog (`?import=<presetId>` auto-open) -->
	<ChildSelectionDialog
		bind:open={showChildSelectionDialog}
		children={childOptions}
		allowMultiple={true}
		onConfirm={handleChildSelectionConfirm}
		onCancel={handleChildSelectionCancel}
		testid="reward-import-child-selection-dialog"
	/>

	<!-- #2362 PR-4: 「他の子供から copy」 dialog -->
	<Dialog
		bind:open={showCopyFromChildDialog}
		title={ADMIN_REWARDS_PAGE_LABELS.copyDialogTitle}
		testid="rewards-copy-from-child-dialog"
	>
		<p class="copy-dialog-desc">
			{ADMIN_REWARDS_PAGE_LABELS.copyDialogDescPrefix}{CHILD_HONORIFIC_LABEL}{ADMIN_REWARDS_PAGE_LABELS.copyDialogDescSuffix}<strong>{selectedChild?.nickname ?? ADMIN_REWARDS_PAGE_LABELS.copyDialogSelectedPlaceholder}</strong>{ADMIN_REWARDS_PAGE_LABELS.copyDialogDescCloseParen}
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
						data-testid="rewards-copy-source-{child.id}"
					/>
					<span class="copy-source-option__label">
						{child.nickname}
						<span class="copy-source-option__age">({child.age} {ADMIN_REWARDS_PAGE_LABELS.copyDialogAgeSuffix})</span>
						<span class="copy-source-option__count">
							{(data.childRewardsByChild[child.id] ?? []).length} {ADMIN_REWARDS_PAGE_LABELS.copyDialogCountSuffix}
						</span>
					</span>
				</label>
			{:else}
				<p class="copy-source-empty">{ADMIN_REWARDS_PAGE_LABELS.copyDialogEmpty}</p>
			{/each}
		</div>
		<div class="copy-dialog-footer">
			<Button variant="ghost" onclick={() => { showCopyFromChildDialog = false; copySourceChildId = null; }}>
				{ADMIN_REWARDS_PAGE_LABELS.copyDialogCancel}
			</Button>
			<Button
				variant="primary"
				disabled={!copySourceChildId}
				data-testid="rewards-copy-from-child-confirm"
				onclick={handleCopyFromChild}
			>
				{ADMIN_REWARDS_PAGE_LABELS.copyDialogConfirm}
			</Button>
		</div>
	</Dialog>
</div>

<style>
	.page-description {
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		padding: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.page-description__title {
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}
	.page-description__text {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.page-description__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.06));
	}
	.page-description__link {
		color: var(--color-action-primary);
		font-weight: 600;
		text-decoration: none;
	}
	.page-description__link:hover {
		text-decoration: underline;
	}

	/* #2362 PR-4: child tab row + actions */
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

	.action-message {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-feedback-info-bg);
		border: 1px solid var(--color-feedback-info-border);
		color: var(--color-feedback-info-text);
		font-size: 0.85rem;
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
</style>

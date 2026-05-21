<script lang="ts">
// /admin/rewards — ごほうび管理 (#2268: CRUD + 命名訂正 + 検索 + grant→add リネーム + 申請タブ削除)
//
// PO 指摘 (2026-05-19):
// - 「とくべつなごほうび/ボーナス贈与」が応援機能を装って混同を招く → 命名訂正
// - 「テンプレート」「マーケットプレイス」UI 露出 → 内部用語撤去
// - 検索性不親切 → 検索 UI 追加
// - CRUD と申請承認の責務混在 → 申請タブ削除 (#2269 で /admin/rewards/requests へ分離)

import { enhance } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import { getErrorMessage } from '$lib/domain/errors';
import { APP_LABELS, PAGE_TITLES, REWARDS_LABELS } from '$lib/domain/labels';
import type { RewardPreviewData } from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import Menu, { type MenuItem } from '$lib/ui/primitives/Menu.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

let selectedChildId = $state(0);

// #2268: 検索 UI 状態
let searchQuery = $state('');

// #2136 MP-1: マーケットプレイス一括追加 UI 状態
let showMarketplace = $state(false);
const marketplaceImport = $derived(
	(
		form as {
			marketplaceImport?: {
				imported?: number;
				skipped?: number;
				allDuplicates?: boolean;
				presetId?: string;
			};
		} | null
	)?.marketplaceImport,
);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

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

	<!-- #2268: 検索 UI -->
	<section>
		<FormField
			label={REWARDS_LABELS.searchLabel}
			type="search"
			bind:value={searchQuery}
			placeholder={REWARDS_LABELS.searchPlaceholder}
		/>
	</section>

	<!-- Child Selector -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{REWARDS_LABELS.selectChildTitle}</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="rounded-xl {selectedChildId === child.id ? '' : 'bg-[var(--color-surface-card)] text-[var(--color-text-muted)] shadow-sm hover:shadow-md'}"
					onclick={() => selectedChildId = child.id}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	</section>

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

	<!-- #2136 MP-1: マーケットプレイスから一括追加 -->
	<section data-testid="marketplace-reward-import-section">
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class="text-sm font-bold text-[var(--color-text-link)] hover:underline px-0"
			onclick={() => { showMarketplace = !showMarketplace; }}
			data-testid="marketplace-reward-import-toggle"
		>
			{REWARDS_LABELS.marketplaceImportToggle(showMarketplace)}
		</Button>

		{#if showMarketplace}
			<div class="mt-2 space-y-2">
				<p class="text-xs text-[var(--color-text-muted)]">
					{REWARDS_LABELS.marketplaceSectionDesc}
				</p>
				{#if marketplaceImport}
					{#if marketplaceImport.allDuplicates}
						<div
							class="bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)] rounded-xl p-3 text-sm text-center"
							data-testid="marketplace-reward-import-result"
						>
							{REWARDS_LABELS.marketplaceImportAllDuplicates}
						</div>
					{:else if (marketplaceImport.imported ?? 0) > 0}
						<div
							class="bg-[var(--color-feedback-success-bg)] border border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)] rounded-xl p-3 text-sm text-center"
							data-testid="marketplace-reward-import-result"
						>
							{REWARDS_LABELS.marketplaceImportSuccess(marketplaceImport.imported ?? 0)}
						</div>
					{/if}
				{/if}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					{#each data.rewardSets as set}
						<form
							method="POST"
							action="?/importMarketplaceRewardSet"
							use:enhance={() => {
								return async ({ update }) => {
									await invalidateAll();
									await update();
								};
							}}
							data-testid="marketplace-reward-form-{set.itemId}"
						>
							<input type="hidden" name="childId" value={selectedChildId} />
							<input type="hidden" name="presetId" value={set.itemId} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								disabled={!data.isPremium}
								class="w-full bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm text-left hover:shadow-md flex-col h-auto items-start"
							>
								<div class="flex items-center gap-2 w-full">
									<span class="text-2xl">{set.icon}</span>
									<div class="flex-1 min-w-0">
										<p class="text-xs font-bold text-[var(--color-text-muted)] truncate">{set.name}</p>
										<p class="text-xs text-[var(--color-text-tertiary)]">
											{REWARDS_LABELS.marketplaceImportButton(set.itemCount)}
										</p>
									</div>
								</div>
							</Button>
						</form>
					{/each}
				</div>
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
</style>

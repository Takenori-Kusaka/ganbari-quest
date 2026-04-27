<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { getErrorMessage } from '$lib/domain/errors';
import {
	ADMIN_SHOP_REQUEST_LABELS,
	APP_LABELS,
	PAGE_TITLES,
	REWARDS_LABELS,
} from '$lib/domain/labels';
import type { RewardPreviewData } from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));
const redemptionError = $derived(
	(form as Record<string, unknown> | null)?.redemptionError as string | undefined,
);

// 申請タブ: 却下フォームの表示管理
let rejectingRequestId = $state<number | null>(null);
let rejectNote = $state('');

function openRejectForm(id: number) {
	rejectingRequestId = id;
	rejectNote = '';
}

function closeRejectForm() {
	rejectingRequestId = null;
	rejectNote = '';
}

// タブ選択
let activeTab = $state<'rewards' | 'requests'>('rewards');

let selectedChildId = $state(0);

$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

// --- Special Reward ---
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
		<PageHelpButton />
		{#if data.pendingRequests.length > 0}
			<span class="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full bg-[var(--color-action-danger)] text-white" data-testid="pending-badge">
				{data.pendingRequests.length}
			</span>
		{/if}
	</div>

	<!-- タブ切り替え -->
	<div class="flex gap-1 border-b border-[var(--color-border)]">
		<button
			type="button"
			class="tab-btn {activeTab === 'rewards' ? 'tab-btn--active' : ''}"
			onclick={() => activeTab = 'rewards'}
			data-testid="tab-rewards"
		>
			{REWARDS_LABELS.rewardsListTab}
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'requests' ? 'tab-btn--active' : ''}"
			onclick={() => activeTab = 'requests'}
			data-testid="tab-requests"
		>
			{ADMIN_SHOP_REQUEST_LABELS.tabLabel}
			{#if data.pendingRequests.length > 0}
				<span class="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-0.5 text-[10px] font-bold rounded-full bg-[var(--color-action-danger)] text-white">
					{data.pendingRequests.length}
				</span>
			{/if}
		</button>
	</div>
	{#if activeTab === 'rewards'}
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

		<!-- Special Reward Templates -->
		<section>
			<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{REWARDS_LABELS.selectTemplateTitle}</h3>
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
				{#each data.templates as tmpl}
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
						<div>
							<p class="text-xs font-bold text-[var(--color-text-muted)] mb-1">{group.groupIcon} {group.groupName}</p>
							<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
								{#each group.rewards as preset}
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
					{/each}
				</div>
			{/if}
		</section>

		<!-- Grant Form -->
		<Card variant="elevated" padding="md">
			{#snippet children()}
			<form
				method="POST"
				action="?/grant"
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

	{:else if activeTab === 'requests'}
		<!-- 申請タブ -->
		{#if redemptionError}
			<Alert variant="danger" message={redemptionError} />
		{/if}

		<!-- 未処理の申請 -->
		<section>
			<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{ADMIN_SHOP_REQUEST_LABELS.tabLabelRequests}</h3>
			{#if data.pendingRequests.length === 0}
				<Alert variant="info" message={ADMIN_SHOP_REQUEST_LABELS.emptyPendingMessage} />
			{:else}
				<div class="space-y-3">
					{#each data.pendingRequests as req (req.id)}
						<Card variant="elevated" padding="md">
							{#snippet children()}
							<div class="request-card">
								<span class="request-icon" aria-hidden="true">{req.rewardIcon ?? '🎁'}</span>
								<div class="request-info">
									<p class="request-title">{req.rewardTitle}</p>
									<p class="request-meta">
										{req.childName} ·
										{req.rewardPoints}{ADMIN_SHOP_REQUEST_LABELS.rewardPointsUnit}
									</p>
									<p class="request-date">
										{ADMIN_SHOP_REQUEST_LABELS.requestedAtLabel}:
										{new Date(req.requestedAt * 1000).toLocaleDateString('ja-JP')}
									</p>
								</div>
								<div class="request-actions">
									{#if rejectingRequestId === req.id}
										<form
											method="POST"
											action="?/rejectRedemption"
											use:enhance={() => {
												return async ({ update }) => {
													closeRejectForm();
													await update();
												};
											}}
											class="reject-form"
										>
											<input type="hidden" name="requestId" value={req.id} />
											<FormField
												label={ADMIN_SHOP_REQUEST_LABELS.rejectNoteLabel}
												type="textarea"
												name="parentNote"
												bind:value={rejectNote}
											/>
											<div class="reject-form-actions">
												<Button type="submit" variant="danger" size="sm">
													{ADMIN_SHOP_REQUEST_LABELS.rejectConfirmButton}
												</Button>
												<Button type="button" variant="ghost" size="sm" onclick={closeRejectForm}>
													{ADMIN_SHOP_REQUEST_LABELS.rejectCancelButton}
												</Button>
											</div>
										</form>
									{:else}
										<form
											method="POST"
											action="?/approveRedemption"
											use:enhance={() => {
												return async ({ update }) => {
													await invalidateAll();
													await update();
												};
											}}
										>
											<input type="hidden" name="requestId" value={req.id} />
											<Button type="submit" variant="success" size="sm" data-testid="approve-btn-{req.id}">
												{ADMIN_SHOP_REQUEST_LABELS.approveButton}
											</Button>
										</form>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onclick={() => openRejectForm(req.id)}
											data-testid="reject-btn-{req.id}"
										>
											{ADMIN_SHOP_REQUEST_LABELS.rejectButton}
										</Button>
									{/if}
								</div>
							</div>
							{/snippet}
						</Card>
					{/each}
				</div>
			{/if}
		</section>

		<!-- 履歴 -->
		{#if data.historyRequests.length > 0}
			<section>
				<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{ADMIN_SHOP_REQUEST_LABELS.historyTabLabel}</h3>
				<div class="space-y-2">
					{#each data.historyRequests as req (req.id)}
						<div class="history-item">
							<span class="history-icon" aria-hidden="true">{req.rewardIcon ?? '🎁'}</span>
							<div class="history-info">
								<p class="history-title">{req.rewardTitle}</p>
								<p class="history-meta">{req.childName} · {req.rewardPoints}{ADMIN_SHOP_REQUEST_LABELS.rewardPointsUnit}</p>
							</div>
							<span class="history-status {req.status === 'approved' ? 'history-status--approved' : 'history-status--rejected'}">
								{req.status === 'approved' ? ADMIN_SHOP_REQUEST_LABELS.statusApproved : ADMIN_SHOP_REQUEST_LABELS.statusRejected}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
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

	.tab-btn {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.tab-btn:hover {
		color: var(--color-text);
	}
	.tab-btn--active {
		color: var(--color-action-primary);
		border-bottom-color: var(--color-action-primary);
	}

	.request-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.request-icon {
		font-size: 2rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.request-info {
		flex: 1;
		min-width: 0;
	}
	.request-title {
		font-weight: 700;
		font-size: 0.9375rem;
		margin: 0;
	}
	.request-meta {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0.125rem 0 0;
	}
	.request-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0.125rem 0 0;
	}
	.request-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex-shrink: 0;
		align-items: flex-end;
	}
	.reject-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}
	.reject-form-actions {
		display: flex;
		gap: 0.5rem;
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}
	.history-icon {
		font-size: 1.5rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.history-info {
		flex: 1;
		min-width: 0;
	}
	.history-title {
		font-weight: 600;
		font-size: 0.875rem;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.history-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}
	.history-status {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		flex-shrink: 0;
	}
	.history-status--approved {
		background: var(--color-surface-success);
		color: var(--color-feedback-success-text);
	}
	.history-status--rejected {
		background: var(--color-surface-muted);
		color: var(--color-text-muted);
	}
</style>

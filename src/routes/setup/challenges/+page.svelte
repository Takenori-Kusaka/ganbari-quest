<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETUP_CHALLENGES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let selectedItems = $state<Set<string>>(new Set());
let submitting = $state(false);
let skipMode = $state(false);
let expandedItem = $state<string | null>(null);

function toggleItem(itemId: string): void {
	skipMode = false;
	const next = new Set(selectedItems);
	if (next.has(itemId)) {
		next.delete(itemId);
	} else {
		next.add(itemId);
	}
	selectedItems = next;
}

function togglePreview(e: Event, itemId: string): void {
	e.stopPropagation();
	expandedItem = expandedItem === itemId ? null : itemId;
}

function selectSkip(): void {
	skipMode = true;
	selectedItems = new Set();
}

// 初期状態で autoAddRecommended な preset を選択 (親が「おすすめを残してそのまま追加」できるように)
$effect(() => {
	const recommended = new Set<string>();
	for (const item of data.presets) {
		if (item.autoAddRecommended) {
			recommended.add(item.id);
		}
	}
	selectedItems = recommended;
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.setupChallenges}{APP_LABELS.setupPageTitleSuffix}</title>
</svelte:head>

<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">{SETUP_CHALLENGES_LABELS.pageTitle}</h2>
<p class="text-sm text-[var(--color-text-muted)] mb-4">
	{SETUP_CHALLENGES_LABELS.pageDesc}
</p>

<p
	class="text-xs text-[var(--color-text-muted)] bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] rounded p-2 mb-4"
>
	{SETUP_CHALLENGES_LABELS.challengesNotice}
</p>

<form
	method="POST"
	action="?/addChallenges"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
>
	<div class="flex flex-col gap-3 mb-4">
		{#each data.presets as item (item.id)}
			{@const selected = selectedItems.has(item.id)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => toggleItem(item.id)}
				class="relative w-full text-left p-4 rounded-xl border-2 h-auto items-start
					{selected
					? 'border-[var(--color-brand-500)] bg-[var(--color-feedback-info-bg)] shadow-sm'
					: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)]'}"
			>
				{#if item.autoAddRecommended}
					<span
						class="absolute -top-2 right-3 text-[10px] font-bold text-white bg-[var(--color-warning)] rounded-full px-2 py-0.5"
					>
						{SETUP_CHALLENGES_LABELS.recommendedBadge}
					</span>
				{/if}
				<div class="flex items-start gap-3">
					<span class="text-2xl mt-0.5">{item.icon}</span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-sm font-bold text-[var(--color-text)]">{item.title}</span>
							<span
								class="text-[10px] font-bold text-[var(--color-brand-700)] bg-[var(--color-feedback-info-bg-strong)] rounded px-1.5 py-0.5"
							>
								{item.baseTarget}{SETUP_CHALLENGES_LABELS.targetSuffix}
							</span>
							<span class="text-xs text-[var(--color-text-muted)]"
								>+{item.rewardPoints}{SETUP_CHALLENGES_LABELS.rewardSuffix}</span
							>
						</div>
						<p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">
							{item.description}
						</p>
						<div class="flex items-center gap-1 mt-2 flex-wrap">
							<span
								class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-muted-strong)] text-[var(--color-text-muted)] rounded"
							>
								{SETUP_CHALLENGES_LABELS.periodFormat(item.startDate, item.endDate)}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="text-[10px] px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-brand-600)] rounded hover:bg-[var(--color-feedback-info-bg-strong)] ml-auto"
								onclick={(e) => togglePreview(e, item.id)}
							>
								{expandedItem === item.id
									? SETUP_CHALLENGES_LABELS.previewToggleClose
									: SETUP_CHALLENGES_LABELS.previewToggleOpen}
							</Button>
						</div>
					</div>
					<div
						class="flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center mt-1
						{selected
							? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)]'
							: 'border-[var(--color-border-strong)]'}"
					>
						{#if selected}
							<span class="text-white text-xs font-bold">&#10003;</span>
						{/if}
					</div>
				</div>
				{#if expandedItem === item.id}
					<div class="mt-3 pt-3 border-t border-[var(--color-border-default)]">
						<div class="text-xs text-[var(--color-text)]">
							{item.description}
						</div>
					</div>
				{/if}
				{#if selected}
					<input type="hidden" name="presetIds" value={item.id} />
				{/if}
			</Button>
		{/each}
	</div>

	<!-- Skip / Auto-add option -->
	<Button
		type="button"
		variant="ghost"
		size="sm"
		onclick={selectSkip}
		class="w-full text-left p-3 rounded-lg border-2 mb-4 h-auto
			{skipMode
			? 'border-[var(--color-neutral-400)] bg-[var(--color-surface-muted)]'
			: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)]'}"
	>
		<div class="flex items-center gap-2">
			<div
				class="w-5 h-5 rounded-full border-2 flex items-center justify-center
				{skipMode
					? 'border-[var(--color-neutral-500)] bg-[var(--color-neutral-500)]'
					: 'border-[var(--color-border-strong)]'}"
			>
				{#if skipMode}
					<span class="text-white text-[10px] font-bold">&#10003;</span>
				{/if}
			</div>
			<span class="text-sm text-[var(--color-text)]">{SETUP_CHALLENGES_LABELS.autoAddOption}</span>
		</div>
	</Button>

	<!-- Navigation buttons -->
	<div class="flex gap-3">
		<a
			href="/setup/activities-defaults"
			class="flex-1 py-2 text-center text-sm font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-muted-strong)] rounded-lg hover:bg-[var(--color-neutral-200)] transition-colors"
		>
			&larr; {SETUP_CHALLENGES_LABELS.backButton}
		</a>
		{#if skipMode}
			<Button
				type="submit"
				formaction="?/autoAdd"
				variant="primary"
				size="sm"
				disabled={submitting}
				class="flex-1"
			>
				{submitting
					? SETUP_CHALLENGES_LABELS.processingLabel
					: SETUP_CHALLENGES_LABELS.skipNextButton}
			</Button>
		{:else}
			<Button
				type="submit"
				variant="primary"
				size="sm"
				disabled={submitting || selectedItems.size === 0}
				class="flex-1"
			>
				{#if submitting}
					{SETUP_CHALLENGES_LABELS.importingLabel}
				{:else}
					{SETUP_CHALLENGES_LABELS.addChallengesButton(selectedItems.size)} &rarr;
				{/if}
			</Button>
		{/if}
	</div>
</form>

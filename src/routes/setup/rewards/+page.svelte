<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETUP_REWARDS_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let selectedItems = $state<Set<string>>(new Set());
let selectedChildId = $state<number>(data.children[0]?.id ?? 0);
let submitting = $state(false);
let skipMode = $state(false);
let expandedItem = $state<string | null>(null);

function isRecommended(min: number, max: number): boolean {
	return min <= data.childAgeMax && max >= data.childAgeMin;
}

function toggleItem(itemId: string) {
	skipMode = false;
	const next = new Set(selectedItems);
	if (next.has(itemId)) {
		next.delete(itemId);
	} else {
		next.add(itemId);
	}
	selectedItems = next;
}

function togglePreview(e: Event, itemId: string) {
	e.stopPropagation();
	expandedItem = expandedItem === itemId ? null : itemId;
}

function selectSkip() {
	skipMode = true;
	selectedItems = new Set();
}

// Auto-select recommended reward sets for the active child's age range
$effect(() => {
	const recommended = new Set<string>();
	for (const item of data.rewardSets) {
		if (isRecommended(item.targetAgeMin, item.targetAgeMax)) {
			recommended.add(item.itemId);
		}
	}
	selectedItems = recommended;
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.setupRewards}{APP_LABELS.setupPageTitleSuffix}</title>
</svelte:head>

<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">{SETUP_REWARDS_LABELS.pageTitle}</h2>
<p class="text-sm text-[var(--color-text-muted)] mb-4">
	{SETUP_REWARDS_LABELS.pageDesc}
</p>

<form
	method="POST"
	action="?/importRewards"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
>
	<!-- Child picker (visible if there are multiple children) -->
	{#if data.children.length > 1}
		<div class="mb-4">
			<div class="text-xs text-[var(--color-text-muted)] mb-1">{SETUP_REWARDS_LABELS.childPickerLabel}</div>
			<div class="flex flex-wrap gap-2">
				{#each data.children as child (child.id)}
					<button
						type="button"
						onclick={() => (selectedChildId = child.id)}
						class="px-3 py-2 rounded-lg border-2 text-sm transition-colors
							{selectedChildId === child.id
							? 'border-[var(--color-brand-500)] bg-[var(--color-feedback-info-bg)] text-[var(--color-text)] font-bold'
							: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'}"
					>
						{child.nickname}
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<input type="hidden" name="childId" value={selectedChildId} />

	<div class="flex flex-col gap-3 mb-4">
		{#each data.rewardSets as item (item.itemId)}
			{@const recommended = isRecommended(item.targetAgeMin, item.targetAgeMax)}
			{@const selected = selectedItems.has(item.itemId)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => toggleItem(item.itemId)}
				class="relative w-full text-left p-4 rounded-xl border-2 h-auto items-start
					{selected
					? 'border-[var(--color-brand-500)] bg-[var(--color-feedback-info-bg)] shadow-sm'
					: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)]'}"
			>
				{#if recommended}
					<span class="absolute -top-2 right-3 text-[10px] font-bold text-white bg-[var(--color-warning)] rounded-full px-2 py-0.5">
						{SETUP_REWARDS_LABELS.recommendedBadge}
					</span>
				{/if}
				<div class="flex items-start gap-3">
					<span class="text-2xl mt-0.5">{item.icon}</span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-sm font-bold text-[var(--color-text)]">{item.name}</span>
							<span class="text-xs text-[var(--color-text-muted)]"
								>{item.rewardCount + SETUP_REWARDS_LABELS.rewardsCountSuffix}</span
							>
						</div>
						<p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{item.description}</p>
						<div class="flex items-center gap-1 mt-2 flex-wrap">
							{#each item.tags as tag (tag)}
								<span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-muted-strong)] text-[var(--color-text-muted)] rounded">{tag}</span>
							{/each}
							<button
								type="button"
								class="text-[10px] px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-brand-600)] rounded hover:bg-[var(--color-feedback-info-bg-strong)] ml-auto"
								onclick={(e) => togglePreview(e, item.itemId)}
							>
								{expandedItem === item.itemId ? '▲ とじる' : '▼ なかみ'}
							</button>
						</div>
					</div>
					<div class="flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center mt-1
						{selected ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)]' : 'border-[var(--color-border-strong)]'}">
						{#if selected}
							<span class="text-white text-xs font-bold">&#10003;</span>
						{/if}
					</div>
				</div>
				{#if expandedItem === item.itemId && item.rewards?.length}
					<div class="mt-3 pt-3 border-t border-[var(--color-border-default)]">
						<div class="grid grid-cols-2 gap-1">
							{#each item.rewards as reward (reward.title)}
								<div class="flex items-center gap-1 text-xs text-[var(--color-text)] py-0.5">
									<span>{reward.icon}</span>
									<span class="truncate flex-1">{reward.title}</span>
									<span class="text-[9px] font-bold text-[var(--color-text-muted)] flex-shrink-0">
										{reward.points}P
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if selected}
					<input type="hidden" name="itemIds" value={item.itemId} />
				{/if}
			</Button>
		{/each}
	</div>

	<!-- Skip option -->
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
			<div class="w-5 h-5 rounded-full border-2 flex items-center justify-center
				{skipMode ? 'border-[var(--color-neutral-500)] bg-[var(--color-neutral-500)]' : 'border-[var(--color-border-strong)]'}">
				{#if skipMode}
					<span class="text-white text-[10px] font-bold">&#10003;</span>
				{/if}
			</div>
			<span class="text-sm text-[var(--color-text)]">{SETUP_REWARDS_LABELS.autoAddOption}</span>
		</div>
	</Button>

	<!-- Navigation buttons -->
	<div class="flex gap-3">
		<a
			href="/setup/packs"
			class="flex-1 py-2 text-center text-sm font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-muted-strong)] rounded-lg hover:bg-[var(--color-neutral-200)] transition-colors"
		>
			&larr; {SETUP_REWARDS_LABELS.backButton}
		</a>
		{#if skipMode}
			<Button type="submit" formaction="?/skip" variant="primary" size="sm" disabled={submitting} class="flex-1">
				{submitting ? SETUP_REWARDS_LABELS.processingLabel : SETUP_REWARDS_LABELS.skipNextButton}
			</Button>
		{:else}
			<Button type="submit" variant="primary" size="sm" disabled={submitting || selectedItems.size === 0} class="flex-1">
				{#if submitting}
					{SETUP_REWARDS_LABELS.importingLabel}
				{:else}
					{SETUP_REWARDS_LABELS.addRewardsButton(selectedItems.size)} &rarr;
				{/if}
			</Button>
		{/if}
	</div>
</form>

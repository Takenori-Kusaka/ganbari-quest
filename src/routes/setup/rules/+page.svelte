<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETUP_RULES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let selectedItems = $state<Set<string>>(new Set());
// svelte-ignore state_referenced_locally
let selectedChildId = $state<number | ''>(data.children[0]?.id ?? '');
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

function ruleTypeLabel(rt: string): string {
	if (rt === 'bonus') return SETUP_RULES_LABELS.ruleTypeBonus;
	if (rt === 'exchange') return SETUP_RULES_LABELS.ruleTypeExchange;
	if (rt === 'penalty') return SETUP_RULES_LABELS.ruleTypePenalty;
	return SETUP_RULES_LABELS.ruleTypeSpecial;
}

// Auto-select bonus presets recommended for the child's age range (exchange は親判断のため auto-select しない)
$effect(() => {
	const recommended = new Set<string>();
	for (const item of data.rulePresets) {
		if (item.ruleType === 'bonus' && isRecommended(item.targetAgeMin, item.targetAgeMax)) {
			recommended.add(item.itemId);
		}
	}
	selectedItems = recommended;
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.setupRules}{APP_LABELS.setupPageTitleSuffix}</title>
</svelte:head>

<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">{SETUP_RULES_LABELS.pageTitle}</h2>
<p class="text-sm text-[var(--color-text-muted)] mb-4">
	{SETUP_RULES_LABELS.pageDesc}
</p>

<p class="text-xs text-[var(--color-text-muted)] bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] rounded p-2 mb-4">
	{SETUP_RULES_LABELS.bonusOnlyNotice}
</p>

<form
	method="POST"
	action="?/importRules"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
>
	<!-- Child picker for exchange rules (any number of children) -->
	{#if data.children.length > 0 && data.rulePresets.some((p) => p.ruleType === 'exchange')}
		<div class="mb-4">
			<div class="text-xs text-[var(--color-text-muted)] mb-1">{SETUP_RULES_LABELS.childPickerLabel}</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => (selectedChildId = '')}
					class="px-3 py-2 rounded-lg border-2 text-sm transition-colors
						{selectedChildId === ''
						? 'border-[var(--color-brand-500)] bg-[var(--color-feedback-info-bg)] text-[var(--color-text)] font-bold'
						: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'}"
				>
					{SETUP_RULES_LABELS.childPickerNone}
				</button>
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
		{#each data.rulePresets as item (item.itemId)}
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
						{SETUP_RULES_LABELS.recommendedBadge}
					</span>
				{/if}
				<div class="flex items-start gap-3">
					<span class="text-2xl mt-0.5">{item.icon}</span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-sm font-bold text-[var(--color-text)]">{item.name}</span>
							<span class="text-[10px] font-bold text-[var(--color-brand-700)] bg-[var(--color-feedback-info-bg-strong)] rounded px-1.5 py-0.5">
								{ruleTypeLabel(item.ruleType)}
							</span>
							<span class="text-xs text-[var(--color-text-muted)]">{item.ruleCount + SETUP_RULES_LABELS.rulesCountSuffix}</span>
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
				{#if expandedItem === item.itemId && item.rules?.length}
					<div class="mt-3 pt-3 border-t border-[var(--color-border-default)]">
						<div class="flex flex-col gap-1">
							{#each item.rules as rule (rule.title)}
								<div class="flex items-center gap-1 text-xs text-[var(--color-text)] py-0.5">
									<span>{rule.icon}</span>
									<span class="truncate flex-1">{rule.title}</span>
									{#if rule.pointBonus !== undefined && rule.pointBonus !== 0}
										<span class="text-[9px] font-bold text-[var(--color-feedback-success-text)] flex-shrink-0">
											+{rule.pointBonus}P
										</span>
									{:else if rule.pointCost !== undefined && rule.pointCost !== 0}
										<span class="text-[9px] font-bold text-[var(--color-feedback-warning-text)] flex-shrink-0">
											-{rule.pointCost}P
										</span>
									{/if}
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
			<span class="text-sm text-[var(--color-text)]">{SETUP_RULES_LABELS.autoAddOption}</span>
		</div>
	</Button>

	<!-- Navigation buttons -->
	<div class="flex gap-3">
		<a
			href="/setup/rewards"
			class="flex-1 py-2 text-center text-sm font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-muted-strong)] rounded-lg hover:bg-[var(--color-neutral-200)] transition-colors"
		>
			&larr; {SETUP_RULES_LABELS.backButton}
		</a>
		{#if skipMode}
			<Button type="submit" formaction="?/skip" variant="primary" size="sm" disabled={submitting} class="flex-1">
				{submitting ? SETUP_RULES_LABELS.processingLabel : SETUP_RULES_LABELS.skipNextButton}
			</Button>
		{:else}
			<Button type="submit" variant="primary" size="sm" disabled={submitting || selectedItems.size === 0} class="flex-1">
				{#if submitting}
					{SETUP_RULES_LABELS.importingLabel}
				{:else}
					{SETUP_RULES_LABELS.addRulesButton(selectedItems.size)} &rarr;
				{/if}
			</Button>
		{/if}
	</div>
</form>

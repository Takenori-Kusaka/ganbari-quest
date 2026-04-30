<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETUP_PACKS_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let selectedPacks = $state<Set<string>>(new Set());
let submitting = $state(false);
let skipMode = $state(false);
let expandedPack = $state<string | null>(null);
// #1758 (#1709-D): must 推奨採用（既定 ON）
let applyMustDefault = $state(true);

function isRecommended(packAgeMin: number, packAgeMax: number): boolean {
	return packAgeMin <= data.childAgeMax && packAgeMax >= data.childAgeMin;
}

function togglePack(packId: string) {
	skipMode = false;
	const next = new Set(selectedPacks);
	if (next.has(packId)) {
		next.delete(packId);
	} else {
		next.add(packId);
	}
	selectedPacks = next;
}

function togglePreview(e: Event, packId: string) {
	e.stopPropagation();
	expandedPack = expandedPack === packId ? null : packId;
}

function selectSkip() {
	skipMode = true;
	selectedPacks = new Set();
}

// Category labels for preview
const categoryLabels: Record<string, string> = {
	undou: 'うんどう',
	benkyou: 'べんきょう',
	seikatsu: 'せいかつ',
	kouryuu: 'こうりゅう',
	souzou: 'そうぞう',
};

// Auto-select recommended packs on mount
$effect(() => {
	const recommended = new Set<string>();
	for (const pack of data.packs) {
		if (isRecommended(pack.targetAgeMin, pack.targetAgeMax)) {
			recommended.add(pack.packId);
		}
	}
	selectedPacks = recommended;
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.setupPacks}{APP_LABELS.setupPageTitleSuffix}</title>
</svelte:head>

<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">{SETUP_PACKS_LABELS.pageTitle}</h2>
<p class="text-sm text-[var(--color-text-muted)] mb-4">
	{SETUP_PACKS_LABELS.pageDesc}
</p>

<form
	method="POST"
	action="?/importPacks"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
>
	<div class="flex flex-col gap-3 mb-4">
		{#each data.packs as pack (pack.packId)}
			{@const recommended = isRecommended(pack.targetAgeMin, pack.targetAgeMax)}
			{@const selected = selectedPacks.has(pack.packId)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => togglePack(pack.packId)}
				class="relative w-full text-left p-4 rounded-xl border-2 h-auto items-start
					{selected
					? 'border-[var(--color-brand-500)] bg-[var(--color-feedback-info-bg)] shadow-sm'
					: 'border-[var(--color-border-default)] bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)]'}"
			>
				{#if recommended}
					<span class="absolute -top-2 right-3 text-[10px] font-bold text-white bg-[var(--color-warning)] rounded-full px-2 py-0.5">
						{SETUP_PACKS_LABELS.recommendedBadge}
					</span>
				{/if}
				<div class="flex items-start gap-3">
					<span class="text-2xl mt-0.5">{pack.icon}</span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-sm font-bold text-[var(--color-text)]">{pack.packName}</span>
							<span class="text-xs text-[var(--color-text-muted)]">{pack.activityCount + '件'}</span>
						</div>
						<p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{pack.description}</p>
						<div class="flex items-center gap-1 mt-2">
							{#each pack.tags as tag}
								<span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-muted-strong)] text-[var(--color-text-muted)] rounded">{tag}</span>
							{/each}
							<button
								type="button"
								class="text-[10px] px-1.5 py-0.5 bg-[var(--color-feedback-info-bg)] text-[var(--color-brand-600)] rounded hover:bg-[var(--color-feedback-info-bg-strong)] ml-auto"
								onclick={(e) => togglePreview(e, pack.packId)}
							>
								{expandedPack === pack.packId ? '▲ とじる' : '▼ なかみ'}
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
				{#if expandedPack === pack.packId && pack.activities?.length}
					<div class="mt-3 pt-3 border-t border-[var(--color-border-default)]">
						<div class="grid grid-cols-2 gap-1">
							{#each pack.activities as act}
								<div class="flex items-center gap-1 text-xs text-[var(--color-text)] py-0.5">
									<span>{act.icon}</span>
									<span class="truncate flex-1">{act.name}</span>
									{#if act.mustDefault}
										<span class="text-[9px] font-bold text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg-strong)] rounded px-1 py-0.5 flex-shrink-0">
											{SETUP_PACKS_LABELS.mustDefaultBadge}
										</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if selected}
					<input type="hidden" name="packIds" value={pack.packId} />
				{/if}
			</Button>
		{/each}
	</div>

	<!-- #1758 (#1709-D): must 推奨採用チェックボックス（選択中のいずれかのパックに mustDefault 候補がある場合のみ表示） -->
	{#if !skipMode && data.packs.some((p) => selectedPacks.has(p.packId) && p.mustDefaultCount > 0)}
		<label
			class="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] mb-3 cursor-pointer"
		>
			<input
				type="checkbox"
				name="applyMustDefault"
				bind:checked={applyMustDefault}
				class="mt-0.5 w-4 h-4 accent-[var(--color-action-primary)]"
			/>
			<span class="flex-1 text-xs text-[var(--color-text)]">
				<span class="font-bold block">{SETUP_PACKS_LABELS.mustDefaultCheckboxLabel}</span>
				<span class="text-[var(--color-text-muted)]">{SETUP_PACKS_LABELS.mustDefaultCheckboxHint}</span>
			</span>
		</label>
	{/if}

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
			<span class="text-sm text-[var(--color-text)]">{SETUP_PACKS_LABELS.autoAddOption}</span>
		</div>
	</Button>

	<!-- Navigation buttons -->
	<div class="flex gap-3">
		<a
			href="/setup/children"
			class="flex-1 py-2 text-center text-sm font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-muted-strong)] rounded-lg hover:bg-[var(--color-neutral-200)] transition-colors"
		>
			&larr; {SETUP_PACKS_LABELS.backButton}
		</a>
		{#if skipMode}
			<Button type="submit" formaction="?/skip" variant="primary" size="sm" disabled={submitting} class="flex-1">
				{submitting ? SETUP_PACKS_LABELS.processingLabel : SETUP_PACKS_LABELS.skipNextButton}
			</Button>
		{:else}
			<Button type="submit" variant="primary" size="sm" disabled={submitting || selectedPacks.size === 0} class="flex-1">
				{#if submitting}
					{SETUP_PACKS_LABELS.importingLabel}
				{:else}
					{SETUP_PACKS_LABELS.addPacksButton(selectedPacks.size)} &rarr;
				{/if}
			</Button>
		{/if}
	</div>
</form>

<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, PACKS_PAGE_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let expandedPack = $state<string | null>(null);
let importing = $state<string | null>(null);
// #1758 (#1709-D): must 推奨採用チェックボックス（既定 ON、パック単位の状態）
const applyMustDefaultByPack = $state<Record<string, boolean>>({});

function getApplyMustDefault(packId: string): boolean {
	return applyMustDefaultByPack[packId] !== false;
}

function toggleApplyMustDefault(packId: string, checked: boolean): void {
	applyMustDefaultByPack[packId] = checked;
}

const categoryLabels: Record<string, string> = {
	undou: 'うんどう',
	benkyou: 'べんきょう',
	seikatsu: 'せいかつ',
	kouryuu: 'こうりゅう',
	souzou: 'そうぞう',
};
</script>

<svelte:head>
	<title>{PAGE_TITLES.packs}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="pb-6">
	<h1 class="text-lg font-bold text-[var(--color-text)] mb-1">{PACKS_PAGE_LABELS.pageTitle}</h1>
	<p class="text-sm text-[var(--color-text-muted)] mb-4">
		{PACKS_PAGE_LABELS.pageDesc}
	</p>

	<div class="flex flex-col gap-4">
		{#each data.packs as pack (pack.packId)}
			<div
				class="rounded-xl border-2 overflow-hidden transition-colors
					{pack.isFullyImported
					? 'border-[var(--color-feedback-success-border)] bg-[var(--color-feedback-success-bg)]'
					: pack.isRecommended
						? 'border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)]'
						: 'border-[var(--color-border)] bg-white'}"
			>
				<!-- Pack header -->
				<button
					type="button"
					class="w-full text-left p-4"
					onclick={() => (expandedPack = expandedPack === pack.packId ? null : pack.packId)}
				>
					<div class="flex items-start gap-3">
						<span class="text-3xl">{pack.icon}</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-bold text-[var(--color-text)]">{pack.packName}</span>
								<span class="text-xs text-[var(--color-text-tertiary)]">{pack.targetAgeMin + '〜'}{pack.targetAgeMax + '歳'}</span>
								{#if pack.isRecommended && !pack.isFullyImported}
									<span class="text-[10px] font-bold text-white bg-[var(--color-stat-amber)] rounded-full px-2 py-0.5">{PACKS_PAGE_LABELS.recommendedBadge}</span>
								{/if}
								{#if pack.isFullyImported}
									<span class="text-[10px] font-bold text-[var(--color-feedback-success-text)] bg-[var(--color-feedback-success-bg-strong)] rounded-full px-2 py-0.5">{PACKS_PAGE_LABELS.importedBadge}</span>
								{:else if pack.importedCount > 0}
									<span class="text-[10px] font-bold text-[var(--color-feedback-info-text)] bg-[var(--color-feedback-info-bg-strong)] rounded-full px-2 py-0.5">
										{pack.importedCount}/{pack.activityCount}{PACKS_PAGE_LABELS.partiallyImportedSuffix}
									</span>
								{/if}
								{#if pack.mustDefaultCount > 0}
									<span class="text-[10px] font-bold text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg-strong)] rounded-full px-2 py-0.5">
										{PACKS_PAGE_LABELS.mustDefaultCount(pack.mustDefaultCount)}
									</span>
								{/if}
							</div>
							<p class="text-sm text-[var(--color-text-muted)] mt-1">{pack.description}</p>
							<div class="flex gap-1 mt-2">
								{#each pack.tags as tag}
									<span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] rounded">{tag}</span>
								{/each}
								<span class="text-[10px] text-[var(--color-text-tertiary)] ml-auto">
									{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount}{PACKS_PAGE_LABELS.activityCountSuffix}
								</span>
							</div>
						</div>
					</div>
				</button>

				<!-- Expanded content -->
				{#if expandedPack === pack.packId}
					<div class="px-4 pb-4 border-t border-[var(--color-border-light)]">
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-3">
							{#each pack.activities as act}
								<div class="flex items-center gap-2 py-1 px-2 rounded text-sm
									{act.alreadyImported ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'}">
									<span>{act.icon}</span>
									<span class="truncate flex-1">{act.name}</span>
									{#if act.mustDefault}
										<span class="text-[10px] font-bold text-[var(--color-feedback-warning-text)] bg-[var(--color-feedback-warning-bg-strong)] rounded px-1.5 py-0.5">
											{PACKS_PAGE_LABELS.mustDefaultBadge}
										</span>
									{/if}
									<span class="text-[10px] text-[var(--color-text-tertiary)]">{categoryLabels[act.categoryCode] ?? act.categoryCode}</span>
									{#if act.alreadyImported}
										<span class="text-[10px] text-[var(--color-feedback-success-text)]">&#10003;</span>
									{/if}
								</div>
							{/each}
						</div>

						{#if !pack.isFullyImported}
							<form method="POST" action="?/importPack" use:enhance={() => {
								importing = pack.packId;
								return async ({ update }) => {
									importing = null;
									await update();
								};
							}}>
								<input type="hidden" name="packId" value={pack.packId} />
								{#if pack.mustDefaultCount > 0}
									<label class="flex items-start gap-2 mt-3 p-3 rounded-lg bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] cursor-pointer">
										<input
											type="checkbox"
											name="applyMustDefault"
											checked={getApplyMustDefault(pack.packId)}
											onchange={(e) => toggleApplyMustDefault(pack.packId, (e.currentTarget as HTMLInputElement).checked)}
											class="mt-0.5 w-4 h-4 accent-[var(--color-action-primary)]"
										/>
										<span class="flex-1 text-xs text-[var(--color-text)]">
											<span class="font-bold block">{PACKS_PAGE_LABELS.mustDefaultCheckboxLabel}</span>
											<span class="text-[var(--color-text-muted)]">{PACKS_PAGE_LABELS.mustDefaultCheckboxHint}</span>
										</span>
									</label>
								{/if}
								<Button
									type="submit"
									variant="primary"
									size="sm"
									disabled={importing === pack.packId}
									class="w-full mt-3"
								>
									{#if importing === pack.packId}
										{PACKS_PAGE_LABELS.importingLabel}
									{:else}
										{PACKS_PAGE_LABELS.importButton(pack.activityCount - pack.importedCount)}
									{/if}
								</Button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

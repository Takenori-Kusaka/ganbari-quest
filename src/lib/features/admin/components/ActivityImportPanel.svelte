<script lang="ts">
import { enhance } from '$app/forms';
import { FEATURES_LABELS } from '$lib/domain/labels';
import type { ActivityPackInfo } from './activity-types';

interface Props {
	activityPacks: ActivityPackInfo[];
	onimported: (message: string) => void;
	onclose: () => void;
}

let { activityPacks, onimported, onclose }: Props = $props();

let importLoading = $state(false);
let fileImportLoading = $state(false);
</script>

<div class="bg-[var(--color-rarity-common-bg)] rounded-xl p-4 shadow-sm space-y-3 border border-[var(--color-border-success)]">
	<div class="flex items-center justify-between">
		<h3 class="font-bold text-[var(--color-action-success)]">{FEATURES_LABELS.activityImportPanel.heading}</h3>
		<a href="/admin/packs" class="text-xs text-[var(--color-action-success)] hover:opacity-80 underline">{FEATURES_LABELS.activityImportPanel.seeAllPacks}</a>
	</div>
	<p class="text-xs text-[var(--color-action-success)]">{FEATURES_LABELS.activityImportPanel.desc}</p>
	{#if activityPacks.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]">{FEATURES_LABELS.activityImportPanel.emptyText}</p>
	{:else}
		<div class="grid grid-cols-1 gap-2">
			{#each activityPacks as pack}
				<form
					method="POST"
					action="?/importPack"
					use:enhance={() => {
						importLoading = true;
						return async ({ result, update }) => {
							importLoading = false;
							if (result.type === 'success' && result.data && 'importResult' in result.data) {
								const d = result.data as Record<string, unknown>;
								onimported(FEATURES_LABELS.activityImportPanel.packResult(String(d.packName), Number(d.imported), Number(d.skipped)));
								onclose();
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="packId" value={pack.packId} />
					<button
						type="submit"
						disabled={importLoading}
						class="w-full flex items-center gap-3 p-3 bg-[var(--color-surface-card)] rounded-lg border border-[var(--color-border-success)] hover:border-[var(--color-border-success-strong)] hover:bg-[var(--color-rarity-common-bg)] transition-colors text-left"
					>
						<span class="text-2xl">{pack.icon}</span>
						<div class="flex-1 min-w-0">
							<p class="font-bold text-sm text-[var(--color-text)]">{pack.packName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{FEATURES_LABELS.activityImportPanel.packMeta(pack.activityCount, pack.targetAgeMin, pack.targetAgeMax)}</p>
						</div>
						<span class="text-xs font-bold text-[var(--color-action-success)] shrink-0">
							{importLoading ? FEATURES_LABELS.activityImportPanel.processingText : FEATURES_LABELS.activityImportPanel.addBtn}
						</span>
					</button>
				</form>
			{/each}
		</div>
	{/if}

	<!-- ファイルからインポート -->
	<div class="border-t border-[var(--color-border-success)] pt-3 mt-3">
		<h4 class="font-bold text-[var(--color-action-success)] text-sm mb-2">{FEATURES_LABELS.activityImportPanel.fileImportHeading}</h4>
		<p class="text-xs text-[var(--color-action-success)] mb-2">{FEATURES_LABELS.activityImportPanel.fileImportDesc}</p>
		<form
			method="POST"
			action="?/importFile"
			enctype="multipart/form-data"
			use:enhance={() => {
				fileImportLoading = true;
				return async ({ result, update }) => {
					fileImportLoading = false;
					if (result.type === 'success' && result.data && 'importResult' in result.data) {
						const d = result.data as Record<string, unknown>;
						onimported(FEATURES_LABELS.activityImportPanel.fileResult(String(d.packName), Number(d.imported), Number(d.skipped)));
						onclose();
					}
					await update({ reset: false });
				};
			}}
		>
			<div class="flex gap-2 items-center">
				<input type="file" name="file" accept=".json,.csv" class="flex-1 text-sm file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-[var(--color-rarity-common-bg)] file:text-[var(--color-action-success)] file:font-bold file:text-xs" required />
				<button type="submit" disabled={fileImportLoading} class="px-4 py-2 bg-[var(--color-action-success)] text-[var(--color-text-inverse)] rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50">
					{fileImportLoading ? FEATURES_LABELS.activityImportPanel.processingText : FEATURES_LABELS.activityImportPanel.fileImportBtn}
				</button>
			</div>
		</form>
	</div>
</div>

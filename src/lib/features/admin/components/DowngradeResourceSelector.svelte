<script lang="ts">
import type { DowngradePreview } from '$lib/domain/downgrade-types';
import { FEATURES_LABELS, getAgeTierLabel, getPlanLabel } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

const L = FEATURES_LABELS.downgradeResourceSelector;

let {
	open = $bindable(false),
	preview,
	loading = false,
	error = null,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	preview: DowngradePreview | null;
	loading?: boolean;
	error?: string | null;
	onConfirm: (selection: {
		childIds: number[];
		activityIds: number[];
		checklistTemplateIds: number[];
	}) => void;
	onCancel: () => void;
} = $props();

// 選択状態: アーカイブ「する」リソースの ID セット
let archiveChildIds = $state(new Set<number>());
let archiveActivityIds = $state(new Set<number>());
let archiveChecklistIds = $state(new Set<number>());

// プレビューが変わったら選択をリセット
$effect(() => {
	if (preview) {
		archiveChildIds = new Set<number>();
		archiveActivityIds = new Set<number>();
		archiveChecklistIds = new Set<number>();
	}
});

// 選択数のバリデーション
const childSelectionValid = $derived(() => {
	if (!preview || preview.children.excess === 0) return true;
	return archiveChildIds.size >= preview.children.excess;
});

const activitySelectionValid = $derived(() => {
	if (!preview || preview.activities.excess === 0) return true;
	return archiveActivityIds.size >= preview.activities.excess;
});

const checklistSelectionValid = $derived(() => {
	if (!preview || preview.checklistTemplates.excessByChild.length === 0) return true;
	for (const item of preview.checklistTemplates.excessByChild) {
		const archivedForChild = [...archiveChecklistIds].filter((id) =>
			preview.checklistTemplates.current.some((t) => t.id === id && t.childId === item.childId),
		).length;
		if (archivedForChild < item.excess) return false;
	}
	return true;
});

const allValid = $derived(
	childSelectionValid() && activitySelectionValid() && checklistSelectionValid(),
);

function toggleChild(id: number) {
	const next = new Set(archiveChildIds);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	archiveChildIds = next;
}

function toggleActivity(id: number) {
	const next = new Set(archiveActivityIds);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	archiveActivityIds = next;
}

function toggleChecklist(id: number) {
	const next = new Set(archiveChecklistIds);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	archiveChecklistIds = next;
}

function handleConfirm() {
	onConfirm({
		childIds: [...archiveChildIds],
		activityIds: [...archiveActivityIds],
		checklistTemplateIds: [...archiveChecklistIds],
	});
}
</script>

<Dialog
	bind:open
	title={L.dialogTitle}
	testid="downgrade-resource-selector"
>
	{#snippet children()}
	{#if preview}
		<div class="space-y-4 text-sm" data-testid="downgrade-preview-content">
			<!-- Target plan display -->
			<div class="rounded-lg bg-[var(--color-surface-muted)] p-3">
				<p class="text-[var(--color-text-secondary)] font-medium">
					{L.targetPlanText(getPlanLabel(preview.targetTier))}
				</p>
				{#if !preview.hasExcess && !preview.retentionChange.willLoseHistory}
					<p class="text-[var(--color-text-muted)] mt-1">
						{L.noExcessText}
					</p>
				{/if}
			</div>

			<!-- Retention warning when no excess -->
			{#if !preview.hasExcess && preview.retentionChange.willLoseHistory}
				<Alert variant="warning">
					{#snippet children()}
					<p>
						{L.retentionWarning(preview.retentionChange.currentDays, preview.retentionChange.targetDays)}
					</p>
					{/snippet}
				</Alert>
			{/if}

			{#if preview.hasExcess}
				<!-- Excess warning -->
				<Alert variant="warning">
					{#snippet children()}
					<p class="font-semibold">
						{L.excessHeading(getPlanLabel(preview.targetTier))}
					</p>
					<p class="mt-1">
						{L.excessDesc}
					</p>
					{/snippet}
				</Alert>

				<!-- Children selection -->
				{#if preview.children.excess > 0}
					<Card variant="default" padding="md">
						{#snippet children()}
						<h4 class="font-semibold text-[var(--color-text-primary)] mb-2">
							{L.childrenSectionTitle(preview.children.current.length, preview.children.max)}
						</h4>
						<p class="text-xs text-[var(--color-text-muted)] mb-3">
							{L.childrenSectionDesc(preview.children.excess, archiveChildIds.size)}
						</p>
						<div class="space-y-2" data-testid="downgrade-child-list">
							{#each preview.children.current as child (child.id)}
								<label
									class="flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors {archiveChildIds.has(child.id) ? 'border-[var(--color-action-danger)] bg-[var(--color-feedback-error-bg)]' : 'border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'}"
									data-testid="downgrade-child-item-{child.id}"
								>
									<input
										type="checkbox"
										checked={archiveChildIds.has(child.id)}
										onchange={() => toggleChild(child.id)}
										class="w-4 h-4 shrink-0 accent-[var(--color-action-danger)]"
									/>
									<div>
										<span class="font-medium text-[var(--color-text-primary)]">{child.name}</span>
										<span class="text-xs text-[var(--color-text-muted)] ml-1">({getAgeTierLabel(child.uiMode)})</span>
									</div>
									{#if archiveChildIds.has(child.id)}
										<span class="ml-auto text-xs text-[var(--color-feedback-error-text)]">{L.archivedLabel}</span>
									{:else}
										<span class="ml-auto text-xs text-[var(--color-text-tertiary)]">{L.keepLabel}</span>
									{/if}
								</label>
							{/each}
						</div>
						{#if !childSelectionValid()}
							<p class="text-xs text-[var(--color-feedback-error-text)] mt-2">
								{L.childrenRemainingText(preview.children.excess - archiveChildIds.size)}
							</p>
						{/if}
						{/snippet}
					</Card>
				{/if}

				<!-- Activities selection -->
				{#if preview.activities.excess > 0}
					<Card variant="default" padding="md">
						{#snippet children()}
						<h4 class="font-semibold text-[var(--color-text-primary)] mb-2">
							{L.activitiesSectionTitle(preview.activities.current.length, preview.activities.max)}
						</h4>
						<p class="text-xs text-[var(--color-text-muted)] mb-3">
							{L.activitiesSectionDesc(preview.activities.excess, archiveActivityIds.size)}
						</p>
						<div class="space-y-2" data-testid="downgrade-activity-list">
							{#each preview.activities.current as activity (activity.id)}
								<label
									class="flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors {archiveActivityIds.has(activity.id) ? 'border-[var(--color-action-danger)] bg-[var(--color-feedback-error-bg)]' : 'border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'}"
									data-testid="downgrade-activity-item-{activity.id}"
								>
									<input
										type="checkbox"
										checked={archiveActivityIds.has(activity.id)}
										onchange={() => toggleActivity(activity.id)}
										class="w-4 h-4 shrink-0 accent-[var(--color-action-danger)]"
									/>
									<span class="text-base">{activity.icon}</span>
									<span class="font-medium text-[var(--color-text-primary)]">{activity.name}</span>
									{#if archiveActivityIds.has(activity.id)}
										<span class="ml-auto text-xs text-[var(--color-feedback-error-text)]">{L.archivedLabel}</span>
									{:else}
										<span class="ml-auto text-xs text-[var(--color-text-tertiary)]">{L.keepLabel}</span>
									{/if}
								</label>
							{/each}
						</div>
						{#if !activitySelectionValid()}
							<p class="text-xs text-[var(--color-feedback-error-text)] mt-2">
								{L.activitiesRemainingText(preview.activities.excess - archiveActivityIds.size)}
							</p>
						{/if}
						{/snippet}
					</Card>
				{/if}

				<!-- Checklist template selection -->
				{#if preview.checklistTemplates.excessByChild.length > 0}
					<Card variant="default" padding="md">
						{#snippet children()}
						<h4 class="font-semibold text-[var(--color-text-primary)] mb-2">
							{L.checklistSectionTitle(preview.checklistTemplates.maxPerChild)}
						</h4>
						{#each preview.checklistTemplates.excessByChild as childExcess (childExcess.childId)}
							{@const childTemplates = preview.checklistTemplates.current.filter(t => t.childId === childExcess.childId)}
							{@const archivedCount = [...archiveChecklistIds].filter(id => childTemplates.some(t => t.id === id)).length}
							<div class="mb-3">
								<p class="text-xs text-[var(--color-text-muted)] mb-2">
									{L.checklistChildExcessDesc(childExcess.childName, childExcess.excess, archivedCount)}
								</p>
								<div class="space-y-2" data-testid="downgrade-checklist-list-{childExcess.childId}">
									{#each childTemplates as template (template.id)}
										<label
											class="flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors {archiveChecklistIds.has(template.id) ? 'border-[var(--color-action-danger)] bg-[var(--color-feedback-error-bg)]' : 'border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'}"
										>
											<input
												type="checkbox"
												checked={archiveChecklistIds.has(template.id)}
												onchange={() => toggleChecklist(template.id)}
												class="w-4 h-4 shrink-0 accent-[var(--color-action-danger)]"
											/>
											<span class="font-medium text-[var(--color-text-primary)]">{template.name}</span>
											{#if archiveChecklistIds.has(template.id)}
												<span class="ml-auto text-xs text-[var(--color-feedback-error-text)]">{L.archivedLabel}</span>
											{:else}
												<span class="ml-auto text-xs text-[var(--color-text-tertiary)]">{L.keepLabel}</span>
											{/if}
										</label>
									{/each}
								</div>
							</div>
						{/each}
						{/snippet}
					</Card>
				{/if}

				<!-- Retention warning -->
				{#if preview.retentionChange.willLoseHistory}
					<Alert variant="warning">
						{#snippet children()}
						<p>
							{L.retentionWarning(preview.retentionChange.currentDays, preview.retentionChange.targetDays)}
						</p>
						{/snippet}
					</Alert>
				{/if}

				<!-- Restore via upgrade explanation -->
				<Alert variant="info">
					{#snippet children()}
					<p>
						{L.archiveRestoreNote}
					</p>
					{/snippet}
				</Alert>
			{/if}

			{#if error}
				<Alert variant="danger">
					{#snippet children()}
					{error}
					{/snippet}
				</Alert>
			{/if}
		</div>

		<!-- Action buttons -->
		<div class="mt-4 flex justify-end gap-2">
			<Button
				type="button"
				variant="secondary"
				size="md"
				disabled={loading}
				onclick={onCancel}
			>
				{L.cancelBtn}
			</Button>
			{#if preview.hasExcess}
				<Button
					type="button"
					variant="primary"
					size="md"
					disabled={loading || !allValid}
					data-testid="downgrade-confirm-button"
					onclick={handleConfirm}
				>
					{loading ? L.archivingText : L.archiveAndProceedBtn}
				</Button>
			{:else}
				<Button
					type="button"
					variant="primary"
					size="md"
					disabled={loading}
					data-testid="downgrade-confirm-button"
					onclick={handleConfirm}
				>
					{loading ? L.processingText : L.proceedBtn}
				</Button>
			{/if}
		</div>
	{:else}
		<div class="flex items-center justify-center py-8">
			<p class="text-sm text-[var(--color-text-muted)]">{L.loadingText}</p>
		</div>
	{/if}
	{/snippet}
</Dialog>

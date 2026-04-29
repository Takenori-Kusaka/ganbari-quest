<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	subscriptionMonths: number;
	lostItems: string[];
	childName?: string;
	childActivityCount?: number;
	onKeep: () => void;
	onCancel: () => void;
}

let {
	open = $bindable(),
	subscriptionMonths,
	lostItems,
	childName,
	childActivityCount,
	onKeep,
	onCancel,
}: Props = $props();
</script>

<Dialog bind:open title={FEATURES_LABELS.loyalty.churnTitle}>
	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<span class="text-2xl">🎖️</span>
			<p class="font-bold">{FEATURES_LABELS.loyalty.churnContinuingMonths(subscriptionMonths)}</p>
		</div>

		{#if lostItems.length > 0}
			<div class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3">
				<p class="text-sm font-bold text-[var(--color-feedback-error-text)] mb-2">{FEATURES_LABELS.loyalty.churnLostHeading}</p>
				<ul class="space-y-1">
					{#each lostItems as item}
						<li class="text-xs text-[var(--color-feedback-error-text)] flex items-start gap-1">
							<span class="text-[var(--color-action-danger)]">{FEATURES_LABELS.loyalty.churnListBullet}</span>
							{item}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if childName && childActivityCount}
			<div class="rounded-lg bg-[var(--color-feedback-info-bg)] p-3">
				<p class="text-sm text-[var(--color-feedback-info-text)]">
					{FEATURES_LABELS.loyalty.churnInsightCount(childName, childActivityCount)}
				</p>
			</div>
		{/if}

		<p class="text-xs text-[var(--color-text-muted)]">
			{FEATURES_LABELS.loyalty.churnNote}
		</p>

		<div class="flex gap-2">
			<Button variant="primary" size="sm" class="flex-1" onclick={onKeep}>
				{FEATURES_LABELS.loyalty.churnKeepBtn}
			</Button>
			<Button variant="ghost" size="sm" class="flex-1" onclick={onCancel}>
				{FEATURES_LABELS.loyalty.churnCancelBtn}
			</Button>
		</div>
	</div>
</Dialog>

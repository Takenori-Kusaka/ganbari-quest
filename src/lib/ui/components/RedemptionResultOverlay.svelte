<script lang="ts">
import { CHILD_SHOP_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	status: 'approved' | 'rejected';
	rewardTitle: string;
	rewardIcon: string | null;
	parentNote: string | null;
	onClose?: () => void;
}

let { open = $bindable(), status, rewardTitle, rewardIcon, parentNote, onClose }: Props = $props();

function handleClose() {
	open = false;
	onClose?.();
}

const isApproved = $derived(status === 'approved');
const title = $derived(
	isApproved
		? CHILD_SHOP_LABELS.approvedTitle(rewardTitle)
		: CHILD_SHOP_LABELS.rejectedTitle(rewardTitle),
);
</script>

<Dialog bind:open closable={false} title="">
	<div class="overlay-body">
		<div class="reward-icon-wrap" class:approved={isApproved} class:rejected={!isApproved}>
			<span class="reward-icon" aria-hidden="true">{rewardIcon ?? '🎁'}</span>
		</div>

		<p class="overlay-title">{title}</p>

		{#if !isApproved && parentNote}
			<p class="parent-note">{parentNote}</p>
		{/if}

		<Button variant="primary" onclick={handleClose} data-testid="redemption-overlay-close">
			{CHILD_SHOP_LABELS.overlayCloseButton}
		</Button>
	</div>
</Dialog>

<style>
	.overlay-body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-md);
		padding: var(--sp-md) 0;
		text-align: center;
	}

	.reward-icon-wrap {
		width: 80px;
		height: 80px;
		border-radius: var(--radius-lg);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.reward-icon-wrap.approved {
		background-color: var(--color-surface-success);
		border: 2px solid var(--color-border-success);
	}

	.reward-icon-wrap.rejected {
		background-color: var(--color-surface-muted);
		border: 2px solid var(--color-border);
	}

	.reward-icon {
		font-size: 2.5rem;
		line-height: 1;
	}

	.overlay-title {
		font-size: 1.1rem;
		font-weight: bold;
		margin: 0;
	}

	.parent-note {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		margin: 0;
		background-color: var(--color-surface-muted);
		padding: var(--sp-sm) var(--sp-md);
		border-radius: var(--radius-sm);
	}
</style>

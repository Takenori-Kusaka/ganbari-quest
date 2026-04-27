<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	onDismiss: () => void;
}

let { open = $bindable(), onDismiss }: Props = $props();

const L = FEATURES_LABELS.trialEndedDialog;
</script>

<Dialog
	{open}
	onOpenChange={(d) => {
		if (!d.open) onDismiss();
	}}
	title={L.title}
	testid="trial-ended-dialog"
	size="sm"
>
	<div class="trial-ended-body">
		<div class="trial-ended-icon" aria-hidden="true">📦</div>

		<p class="trial-ended-message">
			{L.messageLine1}<br />
			{L.messageLine2}
		</p>

		<ul class="trial-ended-notes">
			<li>{L.note1}</li>
			<li>{L.note2}</li>
		</ul>

		<div class="trial-ended-actions">
			<Button
				variant="warning"
				size="md"
				class="w-full"
				onclick={() => { window.location.href = '/admin/license'; }}
				data-testid="trial-ended-upgrade-cta"
			>
				{L.ctaBtn}
			</Button>
			<Button variant="ghost" onclick={onDismiss} data-testid="trial-ended-dismiss">
				{L.dismissBtn}
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.trial-ended-body {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
	}

	.trial-ended-icon {
		font-size: 2.5rem;
	}

	.trial-ended-message {
		font-size: 0.875rem;
		color: var(--color-text-primary);
		line-height: 1.6;
		margin: 0;
	}

	.trial-ended-notes {
		list-style: none;
		padding: 0;
		margin: 0;
		width: 100%;
		text-align: left;
	}

	.trial-ended-notes li {
		position: relative;
		padding-left: 1.25em;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
		margin-bottom: 4px;
	}

	.trial-ended-notes li::before {
		content: '•';
		position: absolute;
		left: 0.25em;
		color: var(--color-text-tertiary);
	}

	.trial-ended-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		margin-top: 4px;
	}
</style>

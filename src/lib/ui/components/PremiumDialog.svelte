<script lang="ts">
import { PLAN_SHORT_LABELS, PREMIUM_MODAL_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	onclose: () => void;
}

let { onclose }: Props = $props();
let open = $state(true);

function handleOpenChange(details: { open: boolean }) {
	if (!details.open) {
		onclose();
	}
}
</script>

<Dialog bind:open onOpenChange={handleOpenChange} title={PREMIUM_MODAL_LABELS.dialogTitle} testid="premium-modal">
	<p class="modal-description">
		{PREMIUM_MODAL_LABELS.description}
	</p>

	<!-- スタンダードプラン -->
	<div class="plan-card">
		<div class="plan-header">
			<h3 class="plan-name">{PLAN_SHORT_LABELS.standard}</h3>
			<span class="plan-price">{PREMIUM_MODAL_LABELS.priceStandard}<span class="plan-price-unit">{PREMIUM_MODAL_LABELS.priceUnit}</span></span>
		</div>
		<ul class="plan-features">
			{#each PREMIUM_MODAL_LABELS.standardFeatures as feature (feature)}
				<li>{feature}</li>
			{/each}
		</ul>
	</div>

	<!-- ファミリープラン -->
	<div class="plan-card plan-card--family">
		<div class="plan-header">
			<h3 class="plan-name">{PLAN_SHORT_LABELS.family}</h3>
			<span class="plan-price">{PREMIUM_MODAL_LABELS.priceFamily}<span class="plan-price-unit">{PREMIUM_MODAL_LABELS.priceUnit}</span></span>
		</div>
		<ul class="plan-features">
			{#each PREMIUM_MODAL_LABELS.familyFeatures as feature (feature)}
				<li>{feature}</li>
			{/each}
		</ul>
	</div>

	<div class="modal-actions">
		<Button variant="primary" size="lg" class="w-full" onclick={() => { window.location.href = '/admin/license'; }}>
			{PREMIUM_MODAL_LABELS.ctaUpgrade}
		</Button>
		<button type="button" class="later-link" onclick={onclose}>
			{PREMIUM_MODAL_LABELS.ctaLater}
		</button>
	</div>
</Dialog>

<style>
	.modal-description {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		margin-bottom: var(--sp-md);
	}

	.plan-card {
		border: 2px solid var(--color-premium-bg);
		border-radius: var(--radius-md);
		padding: var(--sp-md);
		margin-bottom: var(--sp-sm);
	}

	.plan-card--family {
		border-color: var(--color-premium);
		background: var(--color-premium-bg);
	}

	.plan-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--sp-sm);
	}

	.plan-name {
		font-weight: 700;
		font-size: 1rem;
		color: var(--color-premium);
	}

	.plan-price {
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--color-text);
	}

	.plan-price-unit {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.85rem;
	}

	.modal-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-sm);
	}

	.later-link {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.later-link:hover {
		color: var(--color-text);
	}
</style>

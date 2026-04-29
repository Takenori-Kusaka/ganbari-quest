<script lang="ts">
import { APP_LABELS, CANCELLATION_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
</script>

<svelte:head>
	<title>{CANCELLATION_LABELS.successHeading}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="cancel-thanks space-y-6">
	<Card variant="default" padding="lg">
		{#snippet children()}
		<div class="space-y-4">
			<h1 class="text-lg font-bold text-[var(--color-text-primary)]">
				{CANCELLATION_LABELS.successHeading}
			</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				{CANCELLATION_LABELS.successDesc}
			</p>

			{#if data.isPaidPlan && data.hasStripeCustomer && data.stripeEnabled}
				<Alert variant="info">
					{#snippet children()}
					{CANCELLATION_LABELS.successProceedHint}
					{/snippet}
				</Alert>
				<Button
					variant="primary"
					size="md"
					href="/admin/billing"
					data-testid="cancellation-proceed-stripe"
				>
					{CANCELLATION_LABELS.successProceedButton}
				</Button>
			{:else}
				<Button variant="secondary" size="md" href="/admin/license">
					{CANCELLATION_LABELS.successFreeProceed}
				</Button>
			{/if}
		</div>
		{/snippet}
	</Card>
</div>

<style>
	.cancel-thanks {
		max-width: 720px;
	}
</style>

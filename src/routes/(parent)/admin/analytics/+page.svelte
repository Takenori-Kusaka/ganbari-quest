<script lang="ts">
import { ANALYTICS_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
</script>

<svelte:head>
	<title>{ANALYTICS_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<h1 class="text-xl font-bold text-[var(--color-text)]">{ANALYTICS_LABELS.pageHeading}</h1>

	<Alert variant="info">
		<p class="font-semibold">{ANALYTICS_LABELS.comingSoonTitle}</p>
		<p class="text-sm mt-1">{ANALYTICS_LABELS.comingSoonDescription}</p>
	</Alert>

	<Card padding="lg">
		<h2 class="section-title m-0 mb-3">{ANALYTICS_LABELS.plannedSectionTitle}</h2>
		<ul class="planned-list">
			<li>{ANALYTICS_LABELS.plannedItemActivationFunnel}</li>
			<li>{ANALYTICS_LABELS.plannedItemRetention}</li>
			<li>{ANALYTICS_LABELS.plannedItemSeanEllis}</li>
		</ul>
	</Card>
</div>

<style>
	.section-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 0.75rem;
	}

	.planned-list {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.6;
	}

	.planned-list li {
		margin-bottom: 0.25rem;
	}
</style>

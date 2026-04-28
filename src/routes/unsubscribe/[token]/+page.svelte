<script lang="ts">
import { enhance } from '$app/forms';
import { LIFECYCLE_EMAIL_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import type { ActionData, PageData } from './$types';

interface Props {
	data: PageData;
	form: ActionData;
}

let { data, form }: Props = $props();

const labels = LIFECYCLE_EMAIL_LABELS;

const isInvalid = $derived(!data.tokenValid);
const isCompleted = $derived(form?.success === true || data.alreadyUnsubscribed);
let submitting = $state(false);
</script>

<svelte:head>
	<title>{labels.unsubscribePageTitle}</title>
</svelte:head>

<main class="page">
	<Card variant="outlined">
		{#if isInvalid}
			<h1 class="title">{labels.unsubscribeInvalidTitle}</h1>
			<Alert variant="warning" message={labels.unsubscribeInvalidIntro} />
			<div class="actions">
				<Button href="/" variant="ghost">{labels.unsubscribeReturnCta}</Button>
			</div>
		{:else if isCompleted}
			<h1 class="title">{labels.unsubscribeHeading}</h1>
			<Alert variant="success" message={labels.unsubscribeIntro} />
			<div class="actions">
				<Button href="/" variant="ghost">{labels.unsubscribeReturnCta}</Button>
			</div>
		{:else}
			<h1 class="title">{labels.unsubscribeAlreadyTitle}</h1>
			<p class="lead">{labels.unsubscribeAlreadyIntro}</p>
			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<div class="actions">
					<Button type="submit" variant="primary" disabled={submitting}>
						{labels.unsubscribeConfirmCta}
					</Button>
					<Button href="/" variant="ghost">{labels.unsubscribeReturnCta}</Button>
				</div>
			</form>
		{/if}
	</Card>
</main>

<style>
.page {
	max-width: 540px;
	margin: 0 auto;
	padding: 48px 16px;
}

.title {
	font-size: 1.25rem;
	font-weight: 600;
	margin: 0 0 16px;
	color: var(--color-text);
}

.lead {
	margin: 12px 0 24px;
	color: var(--color-text-secondary);
	line-height: 1.7;
}

.actions {
	display: flex;
	gap: 12px;
	margin-top: 24px;
	flex-wrap: wrap;
}
</style>

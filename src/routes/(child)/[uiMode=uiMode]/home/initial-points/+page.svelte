<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, BABY_HOME_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

let submitting = $state(false);
let successMessage = $state('');

$effect(() => {
	if (form?.success) {
		successMessage = BABY_HOME_LABELS.initialPointsSuccess;
		setTimeout(() => {
			successMessage = '';
		}, 3000);
	}
});
</script>

<svelte:head>
	<title>{BABY_HOME_LABELS.initialPointsPageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)] flex flex-col gap-[var(--sp-md)]" data-testid="initial-points-page">
	<div class="flex items-center gap-2">
		<Button
			href="/baby/home"
			variant="ghost"
			size="sm"
			aria-label={BABY_HOME_LABELS.initialPointsBackAriaLabel}
		>
			← {BABY_HOME_LABELS.initialPointsCancel}
		</Button>
	</div>

	<Card>
		<div class="flex flex-col gap-4 py-2">
			<h2 class="text-xl font-bold text-[var(--color-text)]">{BABY_HOME_LABELS.initialPointsPageTitle}</h2>
			<p class="text-sm text-[var(--color-text-secondary)]">{BABY_HOME_LABELS.initialPointsAmountHint}</p>

			{#if data.balance > 0}
				<p class="text-sm font-medium text-[var(--color-text)]">{BABY_HOME_LABELS.currentPoints(data.balance)}</p>
			{/if}

			{#if successMessage}
				<p class="text-sm font-bold text-[var(--color-action-success)] py-1">{successMessage}</p>
			{/if}

			{#if form?.error}
				<p class="text-sm font-bold text-[var(--color-action-danger)] py-1">{form.error}</p>
			{/if}

			<form
				method="POST"
				action="?/grant"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
				class="flex flex-col gap-3"
			>
				<FormField
					label={BABY_HOME_LABELS.initialPointsAmountLabel}
					type="number"
					name="points"
					min={1}
					max={10000}
					required
					hint={BABY_HOME_LABELS.initialPointsAmountHint}
				/>
				<Button type="submit" variant="primary" size="md" disabled={submitting} class="w-full">
					{BABY_HOME_LABELS.initialPointsSubmit}
				</Button>
			</form>
		</div>
	</Card>
</div>

<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETUP_ACTIVITIES_DEFAULTS_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let submitting = $state(false);
let skipMode = $state(false);
</script>

<svelte:head>
	<title>{PAGE_TITLES.setupActivitiesDefaults}{APP_LABELS.setupPageTitleSuffix}</title>
</svelte:head>

<h2 class="text-lg font-bold text-[var(--color-text)] mb-2">
	{SETUP_ACTIVITIES_DEFAULTS_LABELS.pageTitle}
</h2>
<p class="text-sm text-[var(--color-text-muted)] mb-4">
	{SETUP_ACTIVITIES_DEFAULTS_LABELS.pageDesc}
</p>

<p
	class="text-xs text-[var(--color-text-muted)] bg-[var(--color-feedback-info-bg)] border border-[var(--color-feedback-info-border)] rounded p-2 mb-4"
>
	{SETUP_ACTIVITIES_DEFAULTS_LABELS.infoNotice}
</p>

<div
	class="bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] rounded-lg p-4 mb-4"
	data-testid="setup-activities-defaults-summary"
>
	<h3 class="text-sm font-bold text-[var(--color-text)] mb-2">
		{SETUP_ACTIVITIES_DEFAULTS_LABELS.defaultsSummaryTitle}
	</h3>
	<ul class="text-sm text-[var(--color-text-secondary)] space-y-1 list-disc pl-5">
		<li>{SETUP_ACTIVITIES_DEFAULTS_LABELS.defaultDecayLabel}</li>
		<li>{SETUP_ACTIVITIES_DEFAULTS_LABELS.defaultPointModeLabel}</li>
		<li>{SETUP_ACTIVITIES_DEFAULTS_LABELS.defaultSiblingModeLabel}</li>
		<li>{SETUP_ACTIVITIES_DEFAULTS_LABELS.defaultSiblingRankingLabel}</li>
	</ul>
</div>

<form
	method="POST"
	action={skipMode ? '?/skip' : '?/apply'}
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
	class="flex flex-col gap-3"
>
	<Button
		type="submit"
		variant="primary"
		size="md"
		disabled={submitting}
		data-testid="setup-activities-defaults-apply"
		onclick={() => {
			skipMode = false;
		}}
	>
		{submitting && !skipMode
			? SETUP_ACTIVITIES_DEFAULTS_LABELS.applyingLabel
			: SETUP_ACTIVITIES_DEFAULTS_LABELS.applyButton}
	</Button>

	<div class="flex gap-3">
		<a
			href="/setup/rules"
			class="flex-1 py-2 text-center text-sm font-bold text-[var(--color-text-muted)] bg-[var(--color-surface-muted-strong)] rounded-lg hover:bg-[var(--color-neutral-200)] transition-colors"
		>
			&larr; {SETUP_ACTIVITIES_DEFAULTS_LABELS.backButton}
		</a>
		<Button
			type="submit"
			variant="ghost"
			size="md"
			disabled={submitting}
			class="flex-1"
			data-testid="setup-activities-defaults-skip"
			onclick={() => {
				skipMode = true;
			}}
		>
			{SETUP_ACTIVITIES_DEFAULTS_LABELS.skipButton}
		</Button>
	</div>
</form>

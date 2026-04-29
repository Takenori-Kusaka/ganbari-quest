<script lang="ts">
import { enhance } from '$app/forms';
import { PMF_SURVEY_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import type { ActionData, PageData } from './$types';

interface Props {
	data: PageData;
	form: ActionData;
}

let { data, form }: Props = $props();

const labels = PMF_SURVEY_LABELS;

const isInvalid = $derived(!data.tokenValid);
const isCompleted = $derived(form?.success === true);
const isAlreadyAnswered = $derived(data.tokenValid && data.alreadyAnswered && !isCompleted);

let q1 = $state<string>('');
let q2 = $state<string>('');
let q3 = $state<string>('');
let q4 = $state<string>('');
let submitting = $state(false);

const canSubmit = $derived(q1 !== '' && q3 !== '' && !submitting);
</script>

<svelte:head>
	<title>{labels.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="page">
	<Card variant="outlined">
		{#if isInvalid}
			<h1 class="title">{labels.invalidTitle}</h1>
			<Alert variant="warning" message={labels.invalidBody} />
			<div class="actions">
				<Button href="/" variant="ghost">{labels.closeCta}</Button>
			</div>
		{:else if isAlreadyAnswered}
			<h1 class="title">{labels.alreadyAnsweredTitle}</h1>
			<Alert variant="info" message={labels.alreadyAnsweredBody} />
			<div class="actions">
				<Button href="/" variant="ghost">{labels.closeCta}</Button>
			</div>
		{:else if isCompleted}
			<h1 class="title">{labels.thanksHeading}</h1>
			<Alert variant="success" message={labels.thanksBody} />
			<div class="actions">
				<Button href="/" variant="ghost">{labels.closeCta}</Button>
			</div>
		{:else}
			<h1 class="title">{labels.pageHeading}</h1>
			<p class="lead">{labels.pageIntro}</p>

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
				<!-- Q1: Sean Ellis 指標 -->
				<fieldset class="question">
					<legend class="question-legend">
						<span class="badge badge-required">{labels.requiredMark}</span>
						{labels.q1Label}
					</legend>
					{#each Object.entries(labels.q1Options) as [key, label] (key)}
						<label class="radio">
							<input type="radio" name="q1" value={key} bind:group={q1} required />
							<span>{label}</span>
						</label>
					{/each}
				</fieldset>

				<!-- Q2: 主要なベネフィット -->
				<div class="question">
					<FormField
						label={labels.q2Label}
						name="q2"
						type="textarea"
						rows={3}
						bind:value={q2}
						placeholder={labels.q2Placeholder}
						hint={labels.optionalMark}
					/>
				</div>

				<!-- Q3: 認知経路 -->
				<fieldset class="question">
					<legend class="question-legend">
						<span class="badge badge-required">{labels.requiredMark}</span>
						{labels.q3Label}
					</legend>
					{#each Object.entries(labels.q3Options) as [key, label] (key)}
						<label class="radio">
							<input type="radio" name="q3" value={key} bind:group={q3} required />
							<span>{label}</span>
						</label>
					{/each}
				</fieldset>

				<!-- Q4: 離脱要因 -->
				<div class="question">
					<FormField
						label={labels.q4Label}
						name="q4"
						type="textarea"
						rows={3}
						bind:value={q4}
						placeholder={labels.q4Placeholder}
						hint={labels.optionalMark}
					/>
				</div>

				<div class="actions">
					<Button type="submit" variant="primary" disabled={!canSubmit}>
						{submitting ? labels.submitting : labels.submitCta}
					</Button>
				</div>
			</form>
		{/if}
	</Card>
</main>

<style>
.page {
	max-width: 640px;
	margin: 0 auto;
	padding: 32px 16px 64px;
}

.title {
	font-size: 1.25rem;
	font-weight: 600;
	margin: 0 0 12px;
	color: var(--color-text);
}

.lead {
	margin: 0 0 24px;
	color: var(--color-text-secondary);
	line-height: 1.7;
}

.question {
	margin: 24px 0;
	padding: 0;
	border: 0;
}

.question-legend {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: 600;
	margin-bottom: 12px;
	color: var(--color-text);
	font-size: 0.95rem;
}

.badge {
	display: inline-block;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 0.7rem;
	font-weight: 700;
}

.badge-required {
	background: var(--color-feedback-error-bg-strong);
	color: var(--color-feedback-error-text);
}

.radio {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	margin: 6px 0;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	cursor: pointer;
	transition: background 0.15s;
}

.radio:hover {
	background: var(--color-surface-muted);
}

.radio input[type='radio'] {
	margin: 0;
	cursor: pointer;
}

.actions {
	display: flex;
	gap: 12px;
	margin-top: 28px;
	flex-wrap: wrap;
}
</style>

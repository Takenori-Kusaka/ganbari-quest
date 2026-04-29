<script lang="ts">
import { enhance } from '$app/forms';
import {
	APP_LABELS,
	CANCELLATION_CATEGORY,
	CANCELLATION_LABELS,
	type CancellationCategory,
	PAGE_TITLES,
} from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data, form } = $props();

let selectedCategory = $state<CancellationCategory | ''>('');
let freeText = $state<string>('');
let submitting = $state(false);

// form action が再実行されたら state を同期（fail 時のフォーム値復元）
$effect(() => {
	if (form?.category !== undefined) {
		selectedCategory = form.category as CancellationCategory | '';
	}
	if (form?.freeText !== undefined) {
		freeText = form.freeText;
	}
});

const charCount = $derived(freeText.length);
const isOverLimit = $derived(charCount > data.freeTextMaxLength);
const canSubmit = $derived(selectedCategory !== '' && !isOverLimit && !submitting);

function selectCategory(category: CancellationCategory) {
	selectedCategory = category;
}

const submitLabel = $derived(
	data.isPaidPlan ? CANCELLATION_LABELS.submitButton : CANCELLATION_LABELS.submitButtonNoStripe,
);

const noticeText = $derived(
	data.isPaidPlan ? CANCELLATION_LABELS.paidPlanNotice : CANCELLATION_LABELS.freePlanNotice,
);
</script>

<svelte:head>
	<title>{CANCELLATION_LABELS.pageHeading}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="cancel-flow space-y-6">
	<header class="space-y-2">
		<h1 class="text-lg font-bold text-[var(--color-text-primary)]">
			{CANCELLATION_LABELS.pageHeading}
		</h1>
		<p class="text-sm text-[var(--color-text-secondary)]">
			{CANCELLATION_LABELS.pageDesc}
		</p>
	</header>

	<Alert variant="info">
		{#snippet children()}
		{noticeText}
		{/snippet}
	</Alert>

	<form
		method="POST"
		data-testid="cancellation-form"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<Card variant="default" padding="lg">
			{#snippet children()}
			<div class="space-y-5">
				<div class="space-y-1">
					<h2 class="text-base font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
						<span>{CANCELLATION_LABELS.reasonSectionTitle}</span>
						<span class="cancel-required">{CANCELLATION_LABELS.reasonRequired}</span>
					</h2>
				</div>

				<fieldset class="cancel-categories" data-testid="cancellation-categories">
					<legend class="sr-only">{CANCELLATION_LABELS.reasonSectionTitle}</legend>

					<label
						class="cancel-category-option"
						class:cancel-category-option--selected={selectedCategory === CANCELLATION_CATEGORY.GRADUATION}
					>
						<input
							type="radio"
							name="category"
							value={CANCELLATION_CATEGORY.GRADUATION}
							checked={selectedCategory === CANCELLATION_CATEGORY.GRADUATION}
							onchange={() => selectCategory(CANCELLATION_CATEGORY.GRADUATION)}
							data-testid="cancellation-category-graduation"
						/>
						<div class="cancel-category-text">
							<span class="cancel-category-label">
								{CANCELLATION_LABELS.categoryGraduationLabel}
							</span>
							<span class="cancel-category-hint">
								{CANCELLATION_LABELS.categoryGraduationHint}
							</span>
						</div>
					</label>

					<label
						class="cancel-category-option"
						class:cancel-category-option--selected={selectedCategory === CANCELLATION_CATEGORY.CHURN}
					>
						<input
							type="radio"
							name="category"
							value={CANCELLATION_CATEGORY.CHURN}
							checked={selectedCategory === CANCELLATION_CATEGORY.CHURN}
							onchange={() => selectCategory(CANCELLATION_CATEGORY.CHURN)}
							data-testid="cancellation-category-churn"
						/>
						<div class="cancel-category-text">
							<span class="cancel-category-label">
								{CANCELLATION_LABELS.categoryChurnLabel}
							</span>
							<span class="cancel-category-hint">
								{CANCELLATION_LABELS.categoryChurnHint}
							</span>
						</div>
					</label>

					<label
						class="cancel-category-option"
						class:cancel-category-option--selected={selectedCategory === CANCELLATION_CATEGORY.PAUSE}
					>
						<input
							type="radio"
							name="category"
							value={CANCELLATION_CATEGORY.PAUSE}
							checked={selectedCategory === CANCELLATION_CATEGORY.PAUSE}
							onchange={() => selectCategory(CANCELLATION_CATEGORY.PAUSE)}
							data-testid="cancellation-category-pause"
						/>
						<div class="cancel-category-text">
							<span class="cancel-category-label">
								{CANCELLATION_LABELS.categoryPauseLabel}
							</span>
							<span class="cancel-category-hint">
								{CANCELLATION_LABELS.categoryPauseHint}
							</span>
						</div>
					</label>
				</fieldset>

				<div class="space-y-2">
					<label
						for="cancellation-free-text"
						class="block text-sm font-medium text-[var(--color-text-primary)]"
					>
						{CANCELLATION_LABELS.freeTextLabel}
					</label>
					<textarea
						id="cancellation-free-text"
						name="freeText"
						bind:value={freeText}
						placeholder={CANCELLATION_LABELS.freeTextPlaceholder}
						maxlength={data.freeTextMaxLength}
						rows={5}
						data-testid="cancellation-free-text"
						class="cancel-textarea"
					></textarea>
					<p class="cancel-counter" class:cancel-counter--over={isOverLimit}>
						{CANCELLATION_LABELS.freeTextHint(charCount, data.freeTextMaxLength)}
					</p>
				</div>

				{#if form?.error}
					<Alert variant="danger">
						{#snippet children()}
						{form.error}
						{/snippet}
					</Alert>
				{/if}

				<div class="cancel-actions">
					<Button
						type="button"
						variant="secondary"
						size="md"
						href="/admin/billing"
						disabled={submitting}
					>
						{CANCELLATION_LABELS.cancelButton}
					</Button>
					<Button
						type="submit"
						variant="primary"
						size="md"
						disabled={!canSubmit}
						data-testid="cancellation-submit"
					>
						{submitting ? CANCELLATION_LABELS.submitLoading : submitLabel}
					</Button>
				</div>
			</div>
			{/snippet}
		</Card>
	</form>
</div>

<style>
	.cancel-flow {
		max-width: 720px;
	}

	.cancel-required {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--color-feedback-error-bg);
		color: var(--color-feedback-error-text);
	}

	.cancel-categories {
		display: grid;
		gap: 0.75rem;
		border: none;
		padding: 0;
		margin: 0;
	}

	.cancel-category-option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		border: 2px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		cursor: pointer;
		background: var(--color-surface-card);
		transition: border-color 0.15s, background-color 0.15s;
	}

	.cancel-category-option:hover {
		border-color: var(--color-border-focus);
	}

	.cancel-category-option--selected {
		border-color: var(--color-border-focus);
		background: var(--color-surface-accent);
	}

	.cancel-category-option input[type='radio'] {
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.cancel-category-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
	}

	.cancel-category-label {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.cancel-category-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.cancel-textarea {
		width: 100%;
		min-height: 120px;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-surface-card);
		color: var(--color-text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}

	.cancel-textarea:focus {
		outline: none;
		border-color: var(--color-border-focus);
	}

	.cancel-counter {
		text-align: right;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.cancel-counter--over {
		color: var(--color-feedback-error-text);
		font-weight: 600;
	}

	.cancel-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 640px) {
		.cancel-actions {
			flex-direction: column-reverse;
		}

		.cancel-actions :global(a),
		.cancel-actions :global(button) {
			width: 100%;
		}
	}
</style>

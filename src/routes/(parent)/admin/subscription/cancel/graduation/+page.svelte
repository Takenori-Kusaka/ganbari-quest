<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, GRADUATION_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data, form } = $props();

let consented = $state<boolean>(false);
let nickname = $state<string>('');
let message = $state<string>('');
let submitting = $state(false);

// form action 失敗時の値復元
$effect(() => {
	if (form?.consented !== undefined) consented = !!form.consented;
	if (form?.nickname !== undefined) nickname = form.nickname;
	if (form?.message !== undefined) message = form.message;
});

const messageCount = $derived(message.length);
const messageOverLimit = $derived(messageCount > data.messageMaxLength);
const consentNeedsNickname = $derived(consented && nickname.trim().length === 0);
const canSubmit = $derived(!messageOverLimit && !submitting && !consentNeedsNickname);

const errorMessage = $derived(
	form?.errorKey === 'errorNicknameRequired'
		? GRADUATION_LABELS.errorNicknameRequired
		: form?.errorKey === 'errorNicknameTooLong'
			? GRADUATION_LABELS.errorNicknameTooLong
			: form?.errorKey === 'errorMessageTooLong'
				? GRADUATION_LABELS.errorMessageTooLong
				: null,
);

const submitButtonLabel = $derived(
	consented ? GRADUATION_LABELS.submitConsentButton : GRADUATION_LABELS.skipButton,
);
</script>

<svelte:head>
	<title>{GRADUATION_LABELS.pageHeading}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="graduation-flow space-y-6" data-testid="graduation-page">
	<header class="graduation-header">
		<div class="graduation-hero">
			<img
				src="/assets/stamps/daikichi.png"
				alt=""
				class="graduation-character"
				width="160"
				height="160"
			/>
			<div class="graduation-title-block">
				<h1 class="graduation-title" data-testid="graduation-heading">
					{GRADUATION_LABELS.pageHeading}
				</h1>
				<p class="graduation-desc">
					{GRADUATION_LABELS.pageDesc}
				</p>
			</div>
		</div>
	</header>

	<Card variant="default" padding="lg">
		{#snippet children()}
		<div class="space-y-3" data-testid="graduation-points-section">
			<h2 class="graduation-section-title">
				{GRADUATION_LABELS.pointsSectionTitle}
			</h2>
			<p class="graduation-section-hint">{GRADUATION_LABELS.pointsSectionHint}</p>
			<div class="graduation-points-display" data-testid="graduation-points-value">
				{#if data.totalPoints > 0}
					<span class="graduation-points-number">{data.totalPoints.toLocaleString('ja-JP')}</span>
					<span class="graduation-points-unit">{GRADUATION_LABELS.pointsUnit}</span>
				{:else}
					<span class="graduation-points-zero">{GRADUATION_LABELS.pointsZero}</span>
				{/if}
			</div>
			{#if data.usagePeriodDays > 0}
				<p class="graduation-usage-period" data-testid="graduation-usage-period">
					{GRADUATION_LABELS.usagePeriodLabel}: {GRADUATION_LABELS.usagePeriodDays(data.usagePeriodDays)}
				</p>
			{/if}
		</div>
		{/snippet}
	</Card>

	<Card variant="default" padding="lg">
		{#snippet children()}
		<div class="space-y-4" data-testid="graduation-reward-section">
			<h2 class="graduation-section-title">
				{GRADUATION_LABELS.rewardSuggestionTitle}
			</h2>
			<p class="graduation-section-hint">
				{GRADUATION_LABELS.rewardSuggestionHint}
			</p>

			<dl class="graduation-reward-list">
				<div class="graduation-reward-item">
					<dt>{GRADUATION_LABELS.rewardCashLabel}</dt>
					<dd data-testid="graduation-reward-cash">
						{GRADUATION_LABELS.rewardCashDesc(data.yenAmount)}
					</dd>
				</div>
				<div class="graduation-reward-item">
					<dt>{GRADUATION_LABELS.rewardItemsLabel}</dt>
					<dd>{GRADUATION_LABELS.rewardItemsDesc}</dd>
				</div>
				<div class="graduation-reward-item">
					<dt>{GRADUATION_LABELS.rewardExperienceLabel}</dt>
					<dd>{GRADUATION_LABELS.rewardExperienceDesc}</dd>
				</div>
			</dl>

			<Alert variant="info">
				{#snippet children()}
				<strong>{GRADUATION_LABELS.rewardNoteLabel}:</strong>
				{GRADUATION_LABELS.rewardNote}
				{/snippet}
			</Alert>
		</div>
		{/snippet}
	</Card>

	<form
		method="POST"
		data-testid="graduation-form"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<input type="hidden" name="totalPoints" value={data.totalPoints} />
		<input type="hidden" name="usagePeriodDays" value={data.usagePeriodDays} />

		<Card variant="default" padding="lg">
			{#snippet children()}
			<div class="space-y-4" data-testid="graduation-consent-section">
				<h2 class="graduation-section-title">
					{GRADUATION_LABELS.consentSectionTitle}
				</h2>
				<p class="graduation-section-hint">{GRADUATION_LABELS.consentSectionHint}</p>

				<label class="graduation-consent-label">
					<input
						type="checkbox"
						name="consented"
						checked={consented}
						onchange={(e) => {
							consented = (e.currentTarget as HTMLInputElement).checked;
						}}
						data-testid="graduation-consent-checkbox"
					/>
					<span>{GRADUATION_LABELS.consentCheckboxLabel}</span>
				</label>

				<div class="space-y-2">
					<label
						for="graduation-nickname"
						class="graduation-input-label"
					>
						{GRADUATION_LABELS.nicknameLabel}
						{#if consented}
							<span class="graduation-required">{GRADUATION_LABELS.nicknameRequired}</span>
						{/if}
					</label>
					<input
						id="graduation-nickname"
						type="text"
						name="nickname"
						bind:value={nickname}
						placeholder={GRADUATION_LABELS.nicknamePlaceholder}
						maxlength={data.nicknameMaxLength}
						data-testid="graduation-nickname"
						class="graduation-input"
					/>
					<p class="graduation-input-hint">{GRADUATION_LABELS.nicknameHint}</p>
				</div>

				<div class="space-y-2">
					<label
						for="graduation-message"
						class="graduation-input-label"
					>
						{GRADUATION_LABELS.messageLabel}
					</label>
					<textarea
						id="graduation-message"
						name="message"
						bind:value={message}
						placeholder={GRADUATION_LABELS.messagePlaceholder}
						maxlength={data.messageMaxLength}
						rows={4}
						data-testid="graduation-message"
						class="graduation-textarea"
					></textarea>
					<p
						class="graduation-counter"
						class:graduation-counter--over={messageOverLimit}
					>
						{GRADUATION_LABELS.messageHint(messageCount, data.messageMaxLength)}
					</p>
				</div>

				{#if errorMessage}
					<Alert variant="danger">
						{#snippet children()}
						{errorMessage}
						{/snippet}
					</Alert>
				{/if}

				<div class="graduation-actions">
					<Button
						type="submit"
						variant="primary"
						size="md"
						disabled={!canSubmit}
						data-testid="graduation-submit"
					>
						{submitting ? GRADUATION_LABELS.submitLoading : submitButtonLabel}
					</Button>
				</div>
			</div>
			{/snippet}
		</Card>
	</form>
</div>

<style>
	.graduation-flow {
		max-width: 720px;
	}

	.graduation-header {
		text-align: center;
	}

	.graduation-hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.graduation-character {
		width: 160px;
		height: 160px;
		object-fit: contain;
	}

	.graduation-title-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.graduation-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0;
	}

	.graduation-desc {
		font-size: 0.95rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.graduation-section-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0;
	}

	.graduation-section-hint {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.graduation-points-display {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--color-surface-success);
		border: 1px solid var(--color-border-success);
		border-radius: var(--radius-lg, 12px);
	}

	.graduation-points-number {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-feedback-success-text);
	}

	.graduation-points-unit {
		font-size: 1rem;
		color: var(--color-feedback-success-text);
	}

	.graduation-points-zero {
		font-size: 1rem;
		color: var(--color-text-muted);
	}

	.graduation-usage-period {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.graduation-reward-list {
		display: grid;
		gap: 0.875rem;
		margin: 0;
	}

	.graduation-reward-item {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem;
		background: var(--color-surface-muted);
		border-radius: var(--radius-md, 8px);
	}

	.graduation-reward-item dt {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0;
	}

	.graduation-reward-item dd {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.graduation-consent-label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.graduation-consent-label input[type='checkbox'] {
		margin-top: 0.25rem;
	}

	.graduation-input-label {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.graduation-required {
		display: inline-block;
		margin-left: 0.5rem;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--color-feedback-error-bg);
		color: var(--color-feedback-error-text);
	}

	.graduation-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-surface-card);
		color: var(--color-text-primary);
		font-size: 0.9rem;
		font-family: inherit;
	}

	.graduation-input:focus {
		outline: none;
		border-color: var(--color-border-focus);
	}

	.graduation-input-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.graduation-textarea {
		width: 100%;
		min-height: 100px;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-surface-card);
		color: var(--color-text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}

	.graduation-textarea:focus {
		outline: none;
		border-color: var(--color-border-focus);
	}

	.graduation-counter {
		text-align: right;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.graduation-counter--over {
		color: var(--color-feedback-error-text);
		font-weight: 600;
	}

	.graduation-actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	@media (max-width: 640px) {
		.graduation-actions {
			flex-direction: column-reverse;
		}

		.graduation-actions :global(button) {
			width: 100%;
		}
	}
</style>

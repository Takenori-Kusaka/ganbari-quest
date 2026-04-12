<script lang="ts">
import { page } from '$app/stores';
import {
	FEEDBACK_CATEGORIES,
	FEEDBACK_CATEGORY_LABELS,
	type FeedbackCategory,
} from '$lib/domain/validation/feedback';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import Select from '$lib/ui/primitives/Select.svelte';

interface Props {
	open: boolean;
	/** demo mode: show mock success instead of calling API */
	demo?: boolean;
}

let { open = $bindable(), demo = false }: Props = $props();

const MAX_TEXT_LENGTH = 1000;

let categoryValue = $state<string[]>([]);
let text = $state('');
let submitting = $state(false);
let error = $state('');
let successMessage = $state('');

const category = $derived((categoryValue[0] ?? '') as FeedbackCategory | '');
const currentUrl = $derived($page.url.pathname);
const textLength = $derived(text.length);
const isOverLimit = $derived(textLength > MAX_TEXT_LENGTH);
const canSubmit = $derived(
	category !== '' && text.trim().length > 0 && !isOverLimit && !submitting,
);

const categoryItems = FEEDBACK_CATEGORIES.map((c) => ({
	value: c,
	label: FEEDBACK_CATEGORY_LABELS[c],
}));

function resetForm() {
	categoryValue = [];
	text = '';
	error = '';
	successMessage = '';
	submitting = false;
}

function handleOpenChange(details: { open: boolean }) {
	if (!details.open) {
		resetForm();
	}
}

async function handleSubmit() {
	if (!canSubmit) return;

	submitting = true;
	error = '';

	if (demo) {
		// Demo mode: simulate success after short delay
		await new Promise((r) => setTimeout(r, 500));
		successMessage = `${FEEDBACK_CATEGORY_LABELS[category as FeedbackCategory]}を送信しました。ありがとうございます！（デモのため実際には送信されていません）`;
		submitting = false;
		return;
	}

	try {
		const res = await fetch('/api/v1/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				category,
				text: text.trim(),
				currentUrl,
			}),
		});

		const data = await res.json();

		if (!res.ok) {
			error = data.error ?? 'フィードバックの送信に失敗しました';
			submitting = false;
			return;
		}

		successMessage = data.message;
		submitting = false;
	} catch {
		error = 'ネットワークエラーが発生しました。時間をおいて再度お試しください。';
		submitting = false;
	}
}
</script>

<Dialog
	bind:open
	title="ご意見・不具合報告"
	testid="feedback-dialog"
	size="md"
	onOpenChange={handleOpenChange}
>
	{#if successMessage}
		<div class="feedback-success" data-testid="feedback-success">
			<div class="feedback-success-icon">✅</div>
			<p class="feedback-success-text">{successMessage}</p>
			<Button
				variant="primary"
				size="sm"
				onclick={() => { open = false; }}
				data-testid="feedback-close-button"
			>
				とじる
			</Button>
		</div>
	{:else}
		<form
			onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
			class="flex flex-col gap-4"
			data-testid="feedback-form"
		>
			<Select
				label="種別"
				items={categoryItems}
				bind:value={categoryValue}
				placeholder="選択してください"
				error={undefined}
			/>

			<FormField label="内容" error={isOverLimit ? `${MAX_TEXT_LENGTH}文字以内で入力してください` : undefined}>
				{#snippet children()}
					<textarea
						bind:value={text}
						rows={5}
						class="feedback-textarea"
						class:feedback-textarea--error={isOverLimit}
						placeholder="ご意見・不具合の内容を入力してください"
						data-testid="feedback-text"
					></textarea>
				{/snippet}
			</FormField>

			<div class="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
				<span>送信元: {currentUrl}</span>
				<span class:text-\[var\(--color-danger\)\]={isOverLimit}>
					{textLength} / {MAX_TEXT_LENGTH}
				</span>
			</div>

			{#if error}
				<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="feedback-error">
					{error}
				</p>
			{/if}

			<div class="flex gap-2 justify-end">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => { open = false; }}
					type="button"
				>
					キャンセル
				</Button>
				<Button
					variant="primary"
					size="sm"
					type="submit"
					disabled={!canSubmit}
					data-testid="feedback-submit"
				>
					{#if submitting}
						送信中...
					{:else}
						送信する
					{/if}
				</Button>
			</div>
		</form>
	{/if}
</Dialog>

<style>
	.feedback-textarea {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--input-border);
		border-radius: var(--input-radius);
		background: var(--input-bg);
		font-size: 0.875rem;
		resize: vertical;
		min-height: 100px;
		transition: border-color 0.15s;
	}

	.feedback-textarea:focus {
		outline: none;
		border-color: var(--input-border-focus);
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
	}

	.feedback-textarea--error {
		border-color: var(--color-danger);
	}

	.feedback-success {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 1rem 0;
		text-align: center;
	}

	.feedback-success-icon {
		font-size: 2rem;
	}

	.feedback-success-text {
		font-size: 0.875rem;
		color: var(--color-text);
		line-height: 1.5;
	}
</style>

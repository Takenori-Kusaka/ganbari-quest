<script lang="ts">
import { page } from '$app/stores';
import { FEATURES_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import Select from '$lib/ui/primitives/Select.svelte';

interface Props {
	open: boolean;
	isDemo?: boolean;
}

let { open = $bindable(), isDemo = false }: Props = $props();

let category = $state<string[]>([]);
let text = $state('');
let sending = $state(false);
let error = $state('');
let success = $state(false);
/** スクリーンショット dataURL (任意) */
let screenshot = $state('');
let screenshotName = $state('');

const L = FEATURES_LABELS.feedbackDialog;

const CATEGORY_ITEMS = [
	{ value: 'opinion', label: L.categoryOpinion },
	{ value: 'bug', label: L.categoryBug },
	{ value: 'feature', label: L.categoryFeature },
	{ value: 'other', label: L.categoryOther },
];

const MAX_TEXT_LENGTH = 1000;
/** スクリーンショットの最大サイズ (2MB) */
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const charCount = $derived(text.length);
const isOverLimit = $derived(charCount > MAX_TEXT_LENGTH);
const canSubmit = $derived(
	category.length > 0 && text.trim().length > 0 && !isOverLimit && !sending,
);

function reset() {
	category = [];
	text = '';
	error = '';
	success = false;
	screenshot = '';
	screenshotName = '';
}

function handleClose() {
	open = false;
	// 成功表示後に閉じた場合はリセット
	if (success) reset();
}

function handleScreenshotChange(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;

	// ファイルサイズ検証
	if (file.size > MAX_SCREENSHOT_BYTES) {
		error = L.errorScreenshotSize;
		input.value = '';
		return;
	}

	// 画像ファイルのみ許可
	if (!file.type.startsWith('image/')) {
		error = L.errorScreenshotType;
		input.value = '';
		return;
	}

	const reader = new FileReader();
	reader.onload = () => {
		screenshot = reader.result as string;
		screenshotName = file.name;
		error = '';
	};
	reader.onerror = () => {
		error = L.errorReadFile;
	};
	reader.readAsDataURL(file);
}

function removeScreenshot() {
	screenshot = '';
	screenshotName = '';
}

async function handleSubmit() {
	if (!canSubmit) return;

	if (isDemo) {
		success = true;
		return;
	}

	sending = true;
	error = '';

	try {
		const res = await fetch('/api/v1/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				category: category[0],
				text: text.trim(),
				currentUrl: $page.url.pathname,
				...(screenshot ? { screenshot } : {}),
			}),
		});

		if (res.ok) {
			success = true;
		} else {
			const json = await res.json();
			error = json.message ?? L.errorSend;
		}
	} catch {
		error = L.errorNetwork;
	} finally {
		sending = false;
	}
}
</script>

<Dialog bind:open title={L.title} testid="feedback-dialog" size="md" onOpenChange={(d) => { if (!d.open) handleClose(); }}>
	{#if success}
		<div class="space-y-4" data-testid="feedback-success">
			<Alert variant="success">
				{L.successText}
			</Alert>
			<div class="flex justify-end">
				<Button variant="primary" size="sm" onclick={() => { reset(); open = false; }}>
					{L.closeBtn}
				</Button>
			</div>
		</div>
	{:else}
		<form
			class="space-y-4"
			onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
			data-testid="feedback-form"
		>
			{#if isDemo}
				<Alert variant="info">
					{L.demoNote}
				</Alert>
			{/if}

			<Select
				label={L.categoryLabel}
				items={CATEGORY_ITEMS}
				bind:value={category}
				placeholder={L.categoryPlaceholder}
			/>

			<div class="flex flex-col gap-1">
				<label for="feedback-text" class="text-sm font-medium text-[var(--color-text)]">
					{L.contentLabel}
				</label>
				<textarea
					id="feedback-text"
					bind:value={text}
					placeholder={L.contentPlaceholder}
					rows={5}
					class="w-full px-3 py-2 border rounded-lg text-sm resize-y
						border-[var(--color-border-default)]
						focus:outline-none focus:ring-2 focus:ring-[var(--color-border-focus)]
						{isOverLimit ? 'border-[var(--color-action-danger)]' : ''}"
					data-testid="feedback-text"
				></textarea>
				<div class="flex justify-end text-xs {isOverLimit ? 'text-[var(--color-action-danger)]' : 'text-[var(--color-text-disabled)]'}">
					{charCount} / {MAX_TEXT_LENGTH}
				</div>
			</div>

			<!-- スクリーンショット添付（任意） -->
			<div class="flex flex-col gap-1">
				<span class="text-sm font-medium text-[var(--color-text)]">
					{L.screenshotLabel}
				</span>
				{#if screenshot}
					<div class="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border-default)]" data-testid="feedback-screenshot-preview">
						<img
							src={screenshot}
							alt={L.screenshotImageAlt}
							class="max-h-20 rounded object-contain"
						/>
						<span class="text-xs text-[var(--color-text-secondary)] truncate flex-1">
							{screenshotName}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onclick={removeScreenshot}
							data-testid="feedback-screenshot-remove"
						>
							{L.screenshotRemoveBtn}
						</Button>
					</div>
				{:else}
					<label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer
						border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]
						text-sm text-[var(--color-text-secondary)]">
						<span>📷</span>
						<span>{L.screenshotPickerLabel}</span>
						<input
							type="file"
							accept="image/*"
							class="hidden"
							onchange={handleScreenshotChange}
							data-testid="feedback-screenshot-input"
						/>
					</label>
				{/if}
			</div>

			{#if error}
				<Alert variant="danger" data-testid="feedback-error">{error}</Alert>
			{/if}

			<div class="flex gap-2 justify-end">
				<Button variant="ghost" size="sm" onclick={() => { open = false; }} disabled={sending}>
					{L.cancelBtn}
				</Button>
				<Button
					type="submit"
					variant="primary"
					size="sm"
					disabled={!canSubmit}
					data-testid="feedback-submit"
				>
					{#if sending}
						{L.submittingText}
					{:else}
						{L.submitBtn}
					{/if}
				</Button>
			</div>
		</form>
	{/if}
</Dialog>

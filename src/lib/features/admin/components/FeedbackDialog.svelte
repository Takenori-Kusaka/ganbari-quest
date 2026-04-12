<script lang="ts">
import { page } from '$app/stores';
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

const CATEGORY_ITEMS = [
	{ value: 'opinion', label: 'ご意見' },
	{ value: 'bug', label: '不具合報告' },
	{ value: 'feature', label: '機能要望' },
	{ value: 'other', label: 'その他' },
];

const MAX_TEXT_LENGTH = 1000;
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
}

function handleClose() {
	open = false;
	// 成功表示後に閉じた場合はリセット
	if (success) reset();
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
			}),
		});

		if (res.ok) {
			success = true;
		} else {
			const json = await res.json();
			error = json.message ?? '送信に失敗しました';
		}
	} catch {
		error = 'ネットワークエラーが発生しました';
	} finally {
		sending = false;
	}
}
</script>

<Dialog bind:open title="ご意見・不具合報告" testid="feedback-dialog" size="md" onOpenChange={(d) => { if (!d.open) handleClose(); }}>
	{#if success}
		<div class="space-y-4" data-testid="feedback-success">
			<Alert variant="success">
				送信しました。ご意見ありがとうございます！
			</Alert>
			<div class="flex justify-end">
				<Button variant="primary" size="sm" onclick={() => { reset(); open = false; }}>
					閉じる
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
					デモ版のため、実際には送信されません
				</Alert>
			{/if}

			<Select
				label="種別"
				items={CATEGORY_ITEMS}
				bind:value={category}
				placeholder="選択してください"
			/>

			<div class="flex flex-col gap-1">
				<label for="feedback-text" class="text-sm font-medium text-[var(--color-text)]">
					内容
				</label>
				<textarea
					id="feedback-text"
					bind:value={text}
					placeholder="お気づきの点やご要望をお聞かせください"
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

			{#if error}
				<Alert variant="danger" data-testid="feedback-error">{error}</Alert>
			{/if}

			<div class="flex gap-2 justify-end">
				<Button variant="ghost" size="sm" onclick={() => { open = false; }} disabled={sending}>
					キャンセル
				</Button>
				<Button
					type="submit"
					variant="primary"
					size="sm"
					disabled={!canSubmit}
					data-testid="feedback-submit"
				>
					{#if sending}
						送信中...
					{:else}
						送信する
					{/if}
				</Button>
			</div>
		</form>
	{/if}
</Dialog>

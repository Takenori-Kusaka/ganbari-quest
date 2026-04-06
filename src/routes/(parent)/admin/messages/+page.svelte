<script lang="ts">
import { enhance } from '$app/forms';
import { MESSAGE_TEXT_MAX_LENGTH } from '$lib/domain/validation/message';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

const canFreeText = $derived(data.canFreeTextMessage);
const TEXT_MAX = MESSAGE_TEXT_MAX_LENGTH;

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

let messageType = $state<'stamp' | 'text'>('stamp');
let selectedStamp = $state('');
let textBody = $state('');
let sendSuccess = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

function selectStamp(code: string) {
	selectedStamp = code;
	messageType = 'stamp';
}
</script>

<svelte:head>
	<title>おうえんメッセージ - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Description -->
	<div class="page-description">
		<div class="flex items-center gap-2">
			<p class="page-description__title">💌 おうえんメッセージ</p>
			<PageHelpButton />
		</div>
		<p class="page-description__text">
			スタンプやメッセージでこどもを応援しましょう。
			こどもの画面にスタンプが届き、親からの気持ちが伝わります。
		</p>
		<p class="page-description__hint">
			🎁 特別なボーナスポイントの付与は
			<a href="/admin/rewards" class="page-description__link">ごほうび</a>
			から行えます
		</p>
	</div>

	<!-- Step 1: Select child -->
	<section data-tutorial="message-child-select">
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">1. こどもを選択</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class="rounded-xl {selectedChildId === child.id ? '' : 'bg-[var(--color-surface-card)] text-[var(--color-text-muted)] shadow-sm hover:shadow-md'}"
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Choose message type -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">2. おうえんの種類</h3>
		<div class="flex gap-2 mb-3">
			<Button
				variant={messageType === 'stamp' ? 'primary' : 'ghost'}
				size="sm"
				class="rounded-xl {messageType === 'stamp' ? '' : 'bg-[var(--color-surface-card)] text-[var(--color-text-muted)] shadow-sm hover:shadow-md'}"
				onclick={() => (messageType = 'stamp')}
			>
				スタンプ
			</Button>
			{#if canFreeText}
				<Button
					variant={messageType === 'text' ? 'primary' : 'ghost'}
					size="sm"
					class="rounded-xl {messageType === 'text' ? '' : 'bg-[var(--color-surface-card)] text-[var(--color-text-muted)] shadow-sm hover:shadow-md'}"
					onclick={() => (messageType = 'text')}
				>
					ひとことメッセージ
				</Button>
			{:else}
				<Button
					variant="ghost"
					size="sm"
					class="rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] shadow-sm cursor-not-allowed gap-1"
					disabled
					aria-disabled="true"
					aria-describedby="free-text-message-disabled-reason"
					title="ファミリープラン限定"
				>
					ひとことメッセージ
					<span class="text-xs font-bold text-[var(--color-point)]">⭐⭐</span>
				</Button>
				<span id="free-text-message-disabled-reason" class="sr-only">
					ひとことメッセージはファミリープラン限定の機能です。ご利用にはプランのアップグレードが必要です。
				</span>
			{/if}
		</div>

		{#if messageType === 'stamp'}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2" data-tutorial="message-stamp-grid">
				{#each data.stamps as stamp}
					<Button
						variant="ghost"
						size="sm"
						class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm text-center hover:shadow-md flex-col h-auto
							{selectedStamp === stamp.code ? 'ring-2 ring-[var(--color-action-primary)]' : ''}"
						onclick={() => selectStamp(stamp.code)}
					>
						<span class="text-3xl block">{stamp.icon}</span>
						<p class="text-xs font-bold text-[var(--color-text-muted)] mt-1">{stamp.label}</p>
					</Button>
				{/each}
			</div>
		{:else}
			<Card>
				<FormField label="メッセージ（{TEXT_MAX}文字以内）" hint="{textBody.length}/{TEXT_MAX}">
					<textarea
						bind:value={textBody}
						maxlength={TEXT_MAX}
						placeholder="がんばってるね！だいすき！ いつもおうえんしてるよ"
						rows="3"
						class="w-full px-3 py-2 border rounded-[var(--input-radius)] bg-[var(--input-bg)] text-sm
							border-[var(--input-border)] focus:border-[var(--input-border-focus)]
							focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors resize-none"
					></textarea>
				</FormField>
			</Card>
		{/if}
	</section>

	<!-- Step 3: Confirm & send -->
	<Card><form
		method="POST"
		action="?/send"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'success' && result.data && 'sent' in result.data) {
					sendSuccess = true;
					selectedStamp = '';
					textBody = '';
					setTimeout(() => {
						sendSuccess = false;
					}, 3000);
				}
				await update();
			};
		}}
	>
		<input type="hidden" name="childId" value={selectedChildId} />
		<input type="hidden" name="messageType" value={messageType} />
		{#if messageType === 'stamp'}
			<input type="hidden" name="stampCode" value={selectedStamp} />
		{:else}
			<input type="hidden" name="body" value={textBody} />
		{/if}

		<Button
			type="submit"
			disabled={messageType === 'stamp' ? !selectedStamp : !textBody.trim()}
			variant="primary"
			size="md"
			class="w-full rounded-xl"
		>
			{#if messageType === 'stamp'}
				{@const stamp = data.stamps.find((s) => s.code === selectedStamp)}
				{stamp ? `${stamp.icon} ${stamp.label}` : 'スタンプを選んでね'}
			{:else}
				{textBody.trim() ? `💌 「${textBody}」を送る` : 'メッセージを入力してね'}
			{/if}
		</Button>
	</form></Card>

	<!-- Success Message -->
	{#if sendSuccess}
		<div class="bg-[color-mix(in_srgb,var(--color-action-success)_10%,transparent)] rounded-xl p-4 border border-[color-mix(in_srgb,var(--color-action-success)_30%,transparent)] text-center animate-bounce-in">
			<p class="text-[var(--color-action-success)] font-bold">おうえんメッセージを送りました！</p>
		</div>
	{/if}

	<!-- Recent messages for selected child -->
	{#if selectedChild?.recentMessages && selectedChild.recentMessages.length > 0}
		<section>
			<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">最近のメッセージ</h3>
			<div class="space-y-2">
				{#each selectedChild.recentMessages as msg}
					<div class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm flex items-center gap-3">
						<span class="text-2xl">{msg.icon}</span>
						<div class="flex-1 min-w-0">
							{#if msg.messageType === 'stamp' && msg.stampCode}
								{@const stamp = data.stamps.find((s) => s.code === msg.stampCode)}
								<p class="text-sm font-bold text-[var(--color-text)]">{stamp?.label ?? msg.stampCode}</p>
							{:else if msg.body}
								<p class="text-sm font-bold text-[var(--color-text)]">{msg.body}</p>
							{/if}
							<p class="text-xs text-[var(--color-text-muted)]">{new Date(msg.sentAt).toLocaleString('ja-JP')}</p>
						</div>
						{#if msg.shownAt}
							<span class="text-xs text-[var(--color-action-success)]">既読</span>
						{:else}
							<span class="text-xs text-[var(--color-warning)]">未読</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.page-description {
		background: var(--color-surface-card);
		border-radius: 0.75rem;
		padding: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.page-description__title {
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}
	.page-description__text {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.page-description__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.06));
	}
	.page-description__link {
		color: var(--color-action-primary);
		font-weight: 600;
		text-decoration: none;
	}
	.page-description__link:hover {
		text-decoration: underline;
	}
</style>

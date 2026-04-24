<script lang="ts">
import { APP_LABELS, DEMO_MESSAGES_LABELS, MESSAGES_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

let messageType = $state<'stamp' | 'text'>('stamp');
let selectedStamp = $state('');

const selectedChild = $derived(data.children.find((c: { id: number }) => c.id === selectedChildId));
</script>

<svelte:head>
	<title>{PAGE_TITLES.messages}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- Page Description -->
	<div class="page-description">
		<p class="page-description__title">{MESSAGES_LABELS.pageDescTitle}</p>
		<p class="page-description__text">
			{MESSAGES_LABELS.pageDescText1}
			{MESSAGES_LABELS.pageDescText2}
		</p>
		<p class="page-description__hint">
			{MESSAGES_LABELS.pageDescHintPrefix}
			<a href="/demo/admin/rewards" class="page-description__link">{MESSAGES_LABELS.pageDescHintLink}</a>
			{MESSAGES_LABELS.pageDescHintSuffix}
		</p>
	</div>

	<!-- Step 1: Select child -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{MESSAGES_LABELS.selectChildTitle}</h3>
		<div class="flex gap-2 flex-wrap">
			{#each data.children as child}
				<Button
					variant={selectedChildId === child.id ? 'primary' : 'ghost'}
					size="sm"
					class={selectedChildId === child.id
						? ''
						: 'bg-white text-[var(--color-text-secondary)] shadow-sm hover:shadow-md'}
					onclick={() => (selectedChildId = child.id)}
				>
					{child.nickname}
				</Button>
			{/each}
		</div>
	</section>

	<!-- Step 2: Choose message type -->
	<section>
		<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{MESSAGES_LABELS.messageTypeTitle}</h3>
		<div class="flex gap-2 mb-3">
			<Button
				variant={messageType === 'stamp' ? 'primary' : 'ghost'}
				size="sm"
				class={messageType === 'stamp'
					? 'bg-[var(--color-premium)]'
					: 'bg-white text-[var(--color-text-secondary)] shadow-sm hover:shadow-md'}
				onclick={() => (messageType = 'stamp')}
			>
				{MESSAGES_LABELS.stampButton}
			</Button>
			<Button
				variant={messageType === 'text' ? 'primary' : 'ghost'}
				size="sm"
				class={messageType === 'text'
					? 'bg-[var(--color-premium)]'
					: 'bg-white text-[var(--color-text-secondary)] shadow-sm hover:shadow-md'}
				onclick={() => (messageType = 'text')}
			>
				{MESSAGES_LABELS.textMessageButton}
			</Button>
		</div>

		{#if messageType === 'stamp'}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
				{#each data.stamps as stamp}
					<Button
						variant="ghost"
						size="sm"
						class="bg-white rounded-xl p-3 shadow-sm hover:shadow-md
							{selectedStamp === stamp.code ? 'ring-2 ring-[var(--color-premium)]' : ''}"
						onclick={() => { selectedStamp = stamp.code; }}
					>
						<span class="text-3xl block">{stamp.icon}</span>
						<p class="text-xs font-bold text-[var(--color-text-secondary)] mt-1">{stamp.label}</p>
					</Button>
				{/each}
			</div>
		{:else}
			<Card>
				<FormField
					label="メッセージ（30文字以内）"
					type="text"
					maxlength={30}
					disabled
					placeholder="がんばってるね！だいすき！"
				/>
			</Card>
		{/if}
	</section>

	<!-- Step 3: Send button (disabled) -->
	<Card>
		<Button
			variant="ghost"
			size="md"
			class="w-full bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed"
			disabled
		>
			{DEMO_MESSAGES_LABELS.sendDisabled}
		</Button>
	</Card>

	<!-- Recent messages (demo data) -->
	{#if selectedChild?.recentMessages && selectedChild.recentMessages.length > 0}
		<section>
			<h3 class="text-sm font-bold text-[var(--color-text-muted)] mb-2">{MESSAGES_LABELS.recentMessagesTitle}</h3>
			<div class="space-y-2">
				{#each selectedChild.recentMessages as msg}
					<Card padding="sm">
						<div class="flex items-center gap-3">
							<span class="text-2xl">{msg.icon}</span>
							<div class="flex-1 min-w-0">
								{#if msg.messageType === 'stamp' && msg.stampCode}
									{@const stamp = data.stamps.find(
										(s: { code: string }) => s.code === msg.stampCode,
									)}
									<p class="text-sm font-bold text-[var(--color-text-primary)]">
										{stamp?.label ?? msg.stampCode}
									</p>
								{:else if msg.body}
									<p class="text-sm font-bold text-[var(--color-text-primary)]">{msg.body}</p>
								{/if}
								<p class="text-xs text-[var(--color-text-tertiary)]">
									{new Date(msg.sentAt).toLocaleString('ja-JP')}
								</p>
							</div>
							{#if msg.shownAt}
								<span class="text-xs text-[var(--color-feedback-success-text)]">{MESSAGES_LABELS.msgRead}</span>
							{:else}
								<span class="text-xs text-orange-500">{MESSAGES_LABELS.msgUnread}</span>
							{/if}
						</div>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<DemoCta
		title={DEMO_MESSAGES_LABELS.ctaTitle}
		description={DEMO_MESSAGES_LABELS.ctaDesc}
	/>
</div>

<style>
	.page-description {
		background: var(--color-surface-card, white);
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
		color: var(--color-text-muted, #6b7280);
		line-height: 1.5;
	}
	.page-description__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted, #6b7280);
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

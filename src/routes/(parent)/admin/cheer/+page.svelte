<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, CHEER_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();

const errorMessage = $derived((form as { error?: string } | null)?.error);
const granted = $derived(Boolean((form as { granted?: boolean } | null)?.granted));

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

let reason = $state('');
let points = $state(50);
let category = $state<string>('うんどう');
let icon = $state('🎉');
let stampCode = $state('');
let body = $state('');
let grantSuccess = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

const reasonLength = $derived(reason.length);
const reasonRemaining = $derived(data.reasonMaxLength - reasonLength);

const canSubmit = $derived(
	selectedChildId > 0 &&
		reason.trim().length > 0 &&
		reason.length <= data.reasonMaxLength &&
		points >= data.pointsMin &&
		points <= data.pointsMax &&
		data.categories.includes(category as (typeof data.categories)[number]),
);

const categoryOptions = $derived(data.categories.map((c) => ({ value: c, label: c })));

function resetForm() {
	reason = '';
	points = 50;
	category = 'うんどう';
	icon = '🎉';
	stampCode = '';
	body = '';
}

// 成功時はトースト的に 3 秒表示 → form reset
$effect(() => {
	if (granted) {
		grantSuccess = true;
		resetForm();
		const timer = setTimeout(() => {
			grantSuccess = false;
		}, 3000);
		return () => clearTimeout(timer);
	}
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.cheer}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Description -->
	<div class="page-description">
		<div class="flex items-center gap-2">
			<p class="page-description__title">{CHEER_LABELS.pageDescTitle}</p>
		</div>
		<p class="page-description__text">
			{CHEER_LABELS.pageDescText1}
			{CHEER_LABELS.pageDescText2}
		</p>
		<p class="page-description__hint">
			{CHEER_LABELS.pageDescHintPrefix}
			<a href="/admin/rewards" class="page-description__link">{CHEER_LABELS.pageDescHintLink}</a>
			{CHEER_LABELS.pageDescHintSuffix}
		</p>
	</div>

	{#if data.children.length === 0}
		<Card>
			<div class="text-center py-6">
				<p class="text-base font-bold text-[var(--color-text)]">{CHEER_LABELS.noChildrenTitle}</p>
				<p class="text-sm text-[var(--color-text-muted)] mt-2">{CHEER_LABELS.noChildrenDesc}</p>
			</div>
		</Card>
	{:else}
		<form
			method="POST"
			action="?/grant"
			class="space-y-6"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
				};
			}}
		>
			<!-- Step 1: select child -->
			<section data-tutorial="cheer-child-select">
				<h3 class="step-title">{CHEER_LABELS.selectChildTitle}</h3>
				<div class="flex gap-2 flex-wrap">
					{#each data.children as child}
						<Button
							type="button"
							variant={selectedChildId === child.id ? 'primary' : 'ghost'}
							size="sm"
							class="rounded-xl {selectedChildId === child.id ? '' : 'bg-[var(--color-surface-card)] text-[var(--color-text-muted)] shadow-sm hover:shadow-md'}"
							onclick={() => (selectedChildId = child.id)}
						>
							{child.nickname}
						</Button>
					{/each}
				</div>
				<input type="hidden" name="childId" value={selectedChildId} />
			</section>

			<!-- Step 2: reason -->
			<section data-tutorial="cheer-reason">
				<h3 class="step-title">{CHEER_LABELS.reasonTitle}</h3>
				<Card>
					<!-- 日本ローカライズ reason テンプレ (#2300、EPIC #2294 ⑥) — 1 タップで reason / P / category / icon を prefill -->
					<div class="preset-templates">
						<p class="preset-templates__label">{CHEER_LABELS.presetTitle}</p>
						<div class="preset-templates__chips" data-testid="cheer-reason-templates">
							{#each CHEER_LABELS.reasonTemplates as tpl}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="preset-chip"
									data-testid="cheer-reason-template-{tpl.icon}"
									onclick={() => {
										reason = tpl.reason;
										points = tpl.recommendedPoints;
										if (data.categories.includes(tpl.category as (typeof data.categories)[number])) {
											category = tpl.category;
										}
										icon = tpl.icon;
									}}
								>
									<span class="preset-chip__icon">{tpl.icon}</span>
									<span class="preset-chip__text">{tpl.reason}</span>
								</Button>
							{/each}
						</div>
					</div>
					<FormField
						label=""
						type="textarea"
						rows={3}
						name="reason"
						maxlength={data.reasonMaxLength}
						placeholder={CHEER_LABELS.reasonPlaceholder}
						hint="{reasonLength}/{data.reasonMaxLength}（あと{reasonRemaining}文字）"
						bind:value={reason}
					/>
				</Card>
			</section>

			<!-- Step 3: points -->
			<section>
				<h3 class="step-title">{CHEER_LABELS.pointsTitle}</h3>
				<Card>
					<FormField
						label=""
						type="number"
						name="points"
						min={data.pointsMin}
						max={data.pointsMax}
						step={1}
						hint={CHEER_LABELS.pointsHint}
						bind:value={points}
					/>
				</Card>
			</section>

			<!-- Step 4: category -->
			<section>
				<h3 class="step-title">{CHEER_LABELS.categoryTitle}</h3>
				<Card>
					<NativeSelect name="category" bind:value={category} options={categoryOptions} />
				</Card>
			</section>

			<!-- Step 5: icon -->
			<section>
				<h3 class="step-title">{CHEER_LABELS.iconTitle}</h3>
				<Card>
					<FormField
						label=""
						type="text"
						name="icon"
						maxlength={4}
						hint={CHEER_LABELS.iconHint}
						bind:value={icon}
					/>
				</Card>
			</section>

			<!-- Step 6: extra (optional) -->
			<section>
				<h3 class="step-title">{CHEER_LABELS.extraTitle}</h3>
				<p class="text-xs text-[var(--color-text-muted)] mb-2">{CHEER_LABELS.extraDescription}</p>
				<Card>
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
						{#each data.stamps as stamp}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm text-center hover:shadow-md flex-col h-auto {stampCode === stamp.code ? 'ring-2 ring-[var(--color-action-primary)]' : ''}"
								onclick={() => (stampCode = stampCode === stamp.code ? '' : stamp.code)}
							>
								<span class="text-3xl block">{stamp.icon}</span>
								<p class="text-xs font-bold text-[var(--color-text-muted)] mt-1">{stamp.label}</p>
							</Button>
						{/each}
					</div>
					<FormField
						label=""
						type="textarea"
						rows={2}
						name="body"
						maxlength={120}
						placeholder="ひとことメッセージを足す（任意）"
						bind:value={body}
					/>
					<input type="hidden" name="stampCode" value={stampCode} />
				</Card>
			</section>

			<!-- Step 7: confirm + submit -->
			<section>
				<h3 class="step-title">{CHEER_LABELS.confirmTitle}</h3>
				<Card>
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm mb-3">
						<dt class="text-[var(--color-text-muted)]">{CHEER_LABELS.confirmReasonLabel}</dt>
						<dd class="text-[var(--color-text)] font-medium">{reason.trim() || '—'}</dd>
						<dt class="text-[var(--color-text-muted)]">{CHEER_LABELS.confirmPointsLabel}</dt>
						<dd class="text-[var(--color-text)] font-medium">+{points}P</dd>
						<dt class="text-[var(--color-text-muted)]">{CHEER_LABELS.confirmCategoryLabel}</dt>
						<dd class="text-[var(--color-text)] font-medium">{category}</dd>
						<dt class="text-[var(--color-text-muted)]">{CHEER_LABELS.confirmIconLabel}</dt>
						<dd class="text-[var(--color-text)] font-medium">{icon}</dd>
					</dl>
					<Button
						type="submit"
						variant="primary"
						size="md"
						class="w-full rounded-xl"
						disabled={!canSubmit}
					>
						{canSubmit ? CHEER_LABELS.grantButton : CHEER_LABELS.grantButtonDisabled}
					</Button>
				</Card>
			</section>
		</form>
	{/if}

	{#if errorMessage}
		<div class="bg-[var(--color-surface-error)] rounded-xl p-4 border border-[var(--color-feedback-error-border)]">
			<p class="text-[var(--color-feedback-error-text)] font-bold text-sm">{errorMessage}</p>
		</div>
	{/if}

	<!-- Success notification (anti-engagement: no "もう 1 回応援する" CTA per Issue #2267 AC4) -->
	{#if grantSuccess}
		<div
			class="bg-[var(--color-feedback-success-bg)] rounded-xl p-4 border border-[var(--color-feedback-success-border)] text-center animate-bounce-in"
			data-testid="cheer-success"
		>
			<p class="text-[var(--color-feedback-success-text)] font-bold">{CHEER_LABELS.grantSuccess}</p>
		</div>
	{/if}

	<!-- Recent messages history -->
	{#if selectedChild?.recentMessages && selectedChild.recentMessages.length > 0}
		<section>
			<h3 class="step-title">{CHEER_LABELS.historyTitle}</h3>
			<div class="space-y-2">
				{#each selectedChild.recentMessages as msg}
					<div class="bg-[var(--color-surface-card)] rounded-xl p-3 shadow-sm flex items-center gap-3">
						<span class="text-2xl">{msg.icon}</span>
						<div class="flex-1 min-w-0">
							{#if msg.messageType === 'reward_notice'}
								<p class="text-sm font-bold text-[var(--color-text)]">
									{msg.body ?? ''}
									{#if msg.bonusPoints}
										<span class="text-[var(--color-action-primary)]"> +{msg.bonusPoints}P</span>
									{/if}
								</p>
								{#if msg.rewardCategory}
									<p class="text-xs text-[var(--color-text-muted)]">{msg.rewardCategory}</p>
								{/if}
							{:else if msg.messageType === 'stamp' && msg.stampCode}
								{@const stamp = data.stamps.find((s) => s.code === msg.stampCode)}
								<p class="text-sm font-bold text-[var(--color-text)]">{stamp?.label ?? msg.stampCode}</p>
							{:else if msg.body}
								<p class="text-sm font-bold text-[var(--color-text)]">{msg.body}</p>
							{/if}
							<p class="text-xs text-[var(--color-text-muted)]">{new Date(msg.sentAt).toLocaleString('ja-JP')}</p>
						</div>
						{#if msg.shownAt}
							<span class="text-xs text-[var(--color-feedback-success-text)]">{CHEER_LABELS.msgRead}</span>
						{:else}
							<span class="text-xs text-[var(--color-feedback-warning-text)]">{CHEER_LABELS.msgUnread}</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.step-title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}
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
		border-top: 1px solid var(--color-border);
	}
	.page-description__link {
		color: var(--color-action-primary);
		font-weight: 600;
		text-decoration: none;
	}
	.page-description__link:hover {
		text-decoration: underline;
	}
	.preset-templates {
		margin-bottom: 0.75rem;
	}
	.preset-templates__label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 0.375rem;
	}
	.preset-templates__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	:global(.preset-chip) {
		border-radius: 9999px !important;
		background: var(--color-surface-muted);
		font-size: 0.8125rem;
	}
	.preset-chip__icon {
		margin-right: 0.25rem;
	}
	.preset-chip__text {
		font-weight: 600;
	}
</style>

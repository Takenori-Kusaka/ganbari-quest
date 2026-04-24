<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, CONSENT_LABELS } from '$lib/domain/labels';
import Logo from '$lib/ui/components/Logo.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let loading = $state(false);

// 送信可能かの判定（ユーザーに明確なフィードバックを出すため derived で算出）
const needsTerms = $derived(!data.termsAccepted);
const needsPrivacy = $derived(!data.privacyAccepted);
const canSubmit = $derived(
	!loading && (!needsTerms || agreedTerms) && (!needsPrivacy || agreedPrivacy),
);
const submitBlockReason = $derived.by(() => {
	if (loading) return '';
	if (needsTerms && !agreedTerms) return CONSENT_LABELS.errors.termsRequired;
	if (needsPrivacy && !agreedPrivacy) return CONSENT_LABELS.errors.privacyRequired;
	return '';
});
</script>

<svelte:head>
	<title>{data.hasExistingConsent ? CONSENT_LABELS.titleUpdated : CONSENT_LABELS.titleNew}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<!--
	#589: レイアウト修正 — ボタンが viewport 外に出る問題を修正。
	- flex flex-col min-h-dvh で縦積みの上下分割
	- ヘッダー/フォームはスクロール可能領域
	- ボタンは sticky で常に画面下端に固定
-->
<div class="consent-page min-h-dvh flex flex-col" data-testid="consent-page">
	<div class="flex-1 flex items-start justify-center px-4 py-6 overflow-y-auto">
		<Card padding="none" class="w-full max-w-[480px] px-6 py-8 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
			{#snippet children()}
			<div class="text-center mb-6">
				<Logo variant="symbol" size={48} />
				{#if data.hasExistingConsent}
					<h1 class="text-lg font-bold text-[var(--color-text)] mt-2 mb-1" data-testid="consent-heading">{CONSENT_LABELS.headingUpdated}</h1>
					<p class="text-sm text-[var(--color-text-muted)]">
						{CONSENT_LABELS.descUpdated}
					</p>
					{#if data.previousTermsVersion || data.previousPrivacyVersion}
						<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
							{CONSENT_LABELS.previousConsentPrefix}{data.previousTermsVersion ?? CONSENT_LABELS.previousConsentNone}{CONSENT_LABELS.previousConsentArrow}
							{CONSENT_LABELS.previousConsentLatest}{data.currentTermsVersion}
						</p>
					{/if}
				{:else}
					<h1 class="text-lg font-bold text-[var(--color-text)] mt-2 mb-1" data-testid="consent-heading">{CONSENT_LABELS.headingNew}</h1>
					<p class="text-sm text-[var(--color-text-muted)]">
						{CONSENT_LABELS.descNew}
					</p>
				{/if}
			</div>

			{#if form?.error}
				<Alert variant="danger" message={form.error} class="mb-4" />
			{/if}

			<form
				id="consent-form"
				method="POST"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				{#if !data.termsAccepted}
					<div class="p-4 border border-[var(--color-border-default)] rounded-[var(--radius-sm)]">
						<h2 class="text-base font-semibold text-[var(--color-text)] mb-1">{CONSENT_LABELS.termsSectionTitle}</h2>
						<p class="text-xs text-[var(--color-text-tertiary)] mb-2">{CONSENT_LABELS.termsVersionPrefix}{data.currentTermsVersion}</p>
						<a
							href="https://www.ganbari-quest.com/terms.html"
							target="_blank"
							rel="noopener"
							class="text-sm text-[var(--color-text-link)] inline-block mb-3"
						>{CONSENT_LABELS.termsReadLink}</a>
						<FormField label="">
							{#snippet children()}
								<label class="flex items-start gap-2 cursor-pointer text-sm text-[var(--color-text-primary)]">
									<input
										type="checkbox"
										name="agreedTerms"
										bind:checked={agreedTerms}
										data-testid="consent-terms-checkbox"
										class="mt-0.5 w-[18px] h-[18px] shrink-0 accent-[var(--color-action-primary)]"
									/>
									<span>
										{CONSENT_LABELS.termsCheckLabel}
									</span>
								</label>
							{/snippet}
						</FormField>
					</div>
				{:else}
					<input type="hidden" name="agreedTerms" value="on" />
				{/if}

				{#if !data.privacyAccepted}
					<div class="p-4 border border-[var(--color-border-default)] rounded-[var(--radius-sm)]">
						<h2 class="text-base font-semibold text-[var(--color-text)] mb-1">{CONSENT_LABELS.privacySectionTitle}</h2>
						<p class="text-xs text-[var(--color-text-tertiary)] mb-2">{CONSENT_LABELS.privacyVersionPrefix}{data.currentPrivacyVersion}</p>
						<a
							href="https://www.ganbari-quest.com/privacy.html"
							target="_blank"
							rel="noopener"
							class="text-sm text-[var(--color-text-link)] inline-block mb-3"
						>{CONSENT_LABELS.privacyReadLink}</a>
						<FormField label="">
							{#snippet children()}
								<label class="flex items-start gap-2 cursor-pointer text-sm text-[var(--color-text-primary)]">
									<input
										type="checkbox"
										name="agreedPrivacy"
										bind:checked={agreedPrivacy}
										data-testid="consent-privacy-checkbox"
										class="mt-0.5 w-[18px] h-[18px] shrink-0 accent-[var(--color-action-primary)]"
									/>
									<span>
										{CONSENT_LABELS.privacyCheckLabel}
									</span>
								</label>
							{/snippet}
						</FormField>
					</div>
				{:else}
					<input type="hidden" name="agreedPrivacy" value="on" />
				{/if}
			</form>
			{/snippet}
		</Card>
	</div>

	<!-- Sticky bottom bar — ボタンが viewport 外に出ない (#589 + #708) -->
	<div class="consent-sticky-bar sticky bottom-0 w-full px-4 py-4 border-t border-[var(--color-border-default)]">
		<div class="max-w-[480px] mx-auto">
			{#if !canSubmit && !loading}
				<p class="text-center text-xs text-[var(--color-text-muted)] mb-2" data-testid="consent-submit-hint">
					{submitBlockReason}
				</p>
			{/if}
			<Button
				type="submit"
				form="consent-form"
				disabled={!canSubmit}
				class="w-full consent-submit-btn"
				aria-busy={loading}
				data-testid="consent-submit"
			>
				{#if loading}
					{CONSENT_LABELS.submitLoading}
				{:else}
					{CONSENT_LABELS.submitButton}
				{/if}
			</Button>
		</div>
	</div>
</div>

<style>
	.consent-page {
		background: var(--gradient-brand);
	}
	/* #708: sticky bar - opaque + shadow to distinguish from page bg */
	.consent-sticky-bar {
		background: var(--color-surface-card);
		box-shadow: 0 -4px 16px color-mix(in srgb, var(--color-surface-overlay) 24%, transparent);
	}
	/* #708: disabled state - visually clear with opacity + not-allowed */
	.consent-sticky-bar :global(.consent-submit-btn:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>

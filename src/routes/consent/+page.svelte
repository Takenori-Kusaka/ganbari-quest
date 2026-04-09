<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let loading = $state(false);
</script>

<svelte:head>
	<title>規約への同意 - がんばりクエスト</title>
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
					<h1 class="text-lg font-bold text-[var(--color-neutral-900)] mt-2 mb-1" data-testid="consent-heading">規約が更新されました</h1>
					<p class="text-sm text-[var(--color-neutral-500)]">
						サービスの利用を続けるには、更新された規約への同意が必要です。
					</p>
					{#if data.previousTermsVersion || data.previousPrivacyVersion}
						<p class="text-xs text-[var(--color-neutral-400)] mt-2">
							前回同意: {data.previousTermsVersion ?? '未同意'} →
							最新: {data.currentTermsVersion}
						</p>
					{/if}
				{:else}
					<h1 class="text-lg font-bold text-[var(--color-neutral-900)] mt-2 mb-1" data-testid="consent-heading">規約への同意</h1>
					<p class="text-sm text-[var(--color-neutral-500)]">
						サービスの利用を開始するには、規約への同意が必要です。
					</p>
				{/if}
			</div>

			{#if form?.error}
				<div class="mb-4 px-4 py-3 bg-red-50 text-red-700 border border-red-200 rounded-[var(--radius-sm)] text-sm" role="alert">{form.error}</div>
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
						<h2 class="text-base font-semibold text-[var(--color-neutral-900)] mb-1">利用規約</h2>
						<p class="text-xs text-[var(--color-neutral-400)] mb-2">バージョン: {data.currentTermsVersion}</p>
						<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener" class="text-sm text-[var(--color-text-link)] inline-block mb-3">利用規約を確認する</a>
						<FormField label="">
							{#snippet children()}
								<label class="flex items-center gap-2 cursor-pointer text-sm text-[var(--color-neutral-700)]">
									<input
										type="checkbox"
										name="agreedTerms"
										bind:checked={agreedTerms}
										data-testid="consent-terms-checkbox"
										class="w-[18px] h-[18px] accent-[var(--color-brand-600)]"
									/>
									<span>利用規約に同意します</span>
								</label>
							{/snippet}
						</FormField>
					</div>
				{:else}
					<input type="hidden" name="agreedTerms" value="on" />
				{/if}

				{#if !data.privacyAccepted}
					<div class="p-4 border border-[var(--color-border-default)] rounded-[var(--radius-sm)]">
						<h2 class="text-base font-semibold text-[var(--color-neutral-900)] mb-1">プライバシーポリシー</h2>
						<p class="text-xs text-[var(--color-neutral-400)] mb-2">バージョン: {data.currentPrivacyVersion}</p>
						<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener" class="text-sm text-[var(--color-text-link)] inline-block mb-3">プライバシーポリシーを確認する</a>
						<FormField label="">
							{#snippet children()}
								<label class="flex items-center gap-2 cursor-pointer text-sm text-[var(--color-neutral-700)]">
									<input
										type="checkbox"
										name="agreedPrivacy"
										bind:checked={agreedPrivacy}
										data-testid="consent-privacy-checkbox"
										class="w-[18px] h-[18px] accent-[var(--color-brand-600)]"
									/>
									<span>プライバシーポリシーに同意します</span>
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

	<!-- Sticky bottom bar — ボタンが viewport 外に出ない -->
	<div class="sticky bottom-0 w-full px-4 py-4 bg-white/90 backdrop-blur-sm border-t border-[var(--color-border-default)]">
		<div class="max-w-[480px] mx-auto">
			<Button
				type="submit"
				form="consent-form"
				disabled={loading ||
					(!data.termsAccepted && !agreedTerms) ||
					(!data.privacyAccepted && !agreedPrivacy)}
				class="w-full !bg-[var(--gradient-brand)]"
				aria-busy={loading}
				data-testid="consent-submit"
			>
				{#if loading}
					同意中...
				{:else}
					同意して続ける
				{/if}
			</Button>
		</div>
	</div>
</div>

<style>
	.consent-page {
		background: var(--gradient-brand);
	}
</style>

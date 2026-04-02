<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let loading = $state(false);
</script>

<svelte:head>
	<title>規約への同意 - がんばりクエスト</title>
</svelte:head>

<div class="consent-page min-h-dvh flex items-center justify-center p-4">
	<div class="w-full max-w-[480px] bg-[var(--color-surface-card)] rounded-[var(--radius-md)] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		<div class="text-center mb-6">
			<Logo variant="symbol" size={48} />
			<h1 class="text-lg font-bold text-[var(--color-neutral-900)] mt-2 mb-1">規約が更新されました</h1>
			<p class="text-sm text-[var(--color-neutral-500)]">
				サービスの利用を続けるには、更新された規約への同意が必要です。
			</p>
		</div>

		{#if form?.error}
			<div class="mb-4 px-4 py-3 bg-red-50 text-red-700 border border-red-200 rounded-[var(--radius-sm)] text-sm" role="alert">{form.error}</div>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					loading = false;
					await update();
				};
			}}
			class="flex flex-col gap-6"
		>
			<div class="flex flex-col gap-5">
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
			</div>

			<Button
				type="submit"
				disabled={loading ||
					(!data.termsAccepted && !agreedTerms) ||
					(!data.privacyAccepted && !agreedPrivacy)}
				class="w-full !bg-[var(--gradient-brand)]"
				aria-busy={loading}
			>
				{#if loading}
					同意中...
				{:else}
					同意して続ける
				{/if}
			</Button>
		</form>
	</div>
</div>

<style>
	.consent-page {
		background: var(--gradient-brand);
	}
</style>

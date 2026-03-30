<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';

let { data, form } = $props();
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let loading = $state(false);
</script>

<svelte:head>
	<title>規約への同意 - がんばりクエスト</title>
</svelte:head>

<div class="consent-page">
	<div class="consent-card">
		<div class="consent-header">
			<Logo variant="symbol" size={48} />
			<h1>規約が更新されました</h1>
			<p class="consent-subtitle">
				サービスの利用を続けるには、更新された規約への同意が必要です。
			</p>
		</div>

		{#if form?.error}
			<div class="consent-error" role="alert">{form.error}</div>
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
			class="consent-form"
		>
			<div class="consent-items">
				{#if !data.termsAccepted}
					<div class="consent-item">
						<h2>利用規約</h2>
						<p>バージョン: {data.currentTermsVersion}</p>
						<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener">利用規約を確認する</a>
						<label class="consent-label">
							<input
								type="checkbox"
								name="agreedTerms"
								bind:checked={agreedTerms}
								class="consent-checkbox"
							/>
							<span>利用規約に同意します</span>
						</label>
					</div>
				{:else}
					<input type="hidden" name="agreedTerms" value="on" />
				{/if}

				{#if !data.privacyAccepted}
					<div class="consent-item">
						<h2>プライバシーポリシー</h2>
						<p>バージョン: {data.currentPrivacyVersion}</p>
						<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener">プライバシーポリシーを確認する</a>
						<label class="consent-label">
							<input
								type="checkbox"
								name="agreedPrivacy"
								bind:checked={agreedPrivacy}
								class="consent-checkbox"
							/>
							<span>プライバシーポリシーに同意します</span>
						</label>
					</div>
				{:else}
					<input type="hidden" name="agreedPrivacy" value="on" />
				{/if}
			</div>

			<button
				type="submit"
				disabled={loading ||
					(!data.termsAccepted && !agreedTerms) ||
					(!data.privacyAccepted && !agreedPrivacy)}
				class="consent-button"
				aria-busy={loading}
			>
				{#if loading}
					同意中...
				{:else}
					同意して続ける
				{/if}
			</button>
		</form>
	</div>
</div>

<style>
	.consent-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		padding: 16px;
	}
	.consent-card {
		width: 100%;
		max-width: 480px;
		background: white;
		border-radius: 16px;
		padding: 40px 32px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
	}
	.consent-header {
		text-align: center;
		margin-bottom: 24px;
	}
	.consent-header h1 {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1e293b;
		margin: 8px 0 4px;
	}
	.consent-subtitle {
		font-size: 0.875rem;
		color: #64748b;
	}
	.consent-error {
		margin-bottom: 16px;
		padding: 12px 16px;
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
		border-radius: 8px;
		font-size: 0.875rem;
	}
	.consent-form {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.consent-items {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.consent-item {
		padding: 16px;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
	}
	.consent-item h2 {
		font-size: 1rem;
		font-weight: 600;
		color: #1e293b;
		margin: 0 0 4px;
	}
	.consent-item p {
		font-size: 0.8rem;
		color: #94a3b8;
		margin: 0 0 8px;
	}
	.consent-item a {
		font-size: 0.85rem;
		color: #667eea;
		display: inline-block;
		margin-bottom: 12px;
	}
	.consent-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 0.9rem;
		color: #374151;
	}
	.consent-checkbox {
		width: 18px;
		height: 18px;
		accent-color: #667eea;
	}
	.consent-button {
		padding: 14px;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		font-size: 1rem;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.consent-button:hover:not(:disabled) {
		opacity: 0.9;
	}
	.consent-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>

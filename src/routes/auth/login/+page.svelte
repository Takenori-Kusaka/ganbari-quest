<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';

let { data, form } = $props();

// form は複数の action から異なる型が返るためキャスト
const f = () => form as Record<string, unknown> | null;

let email = $state(form?.email ?? '');
let password = $state('');
let mfaCode = $state('');
let loading = $state(false);

// MFA ステップ: サーバーから session/challengeName が返ってきた場合
let mfaStep = $derived((f()?.mfaStep as boolean) ?? false);
let mfaSession = $derived((f()?.session as string) ?? '');
let mfaChallengeName = $derived((f()?.challengeName as string) ?? '');
</script>

<svelte:head>
	<title>ログイン - がんばりクエスト</title>
</svelte:head>

<div class="login-page">
	<div class="login-card">
		<div class="login-header">
			<Logo variant="symbol" size={64} />
			<h1 class="login-title">がんばりクエスト</h1>
			<p class="login-subtitle">{mfaStep ? 'MFA認証' : 'ログイン'}</p>
		</div>

		{#if form?.error}
			<div class="login-error" role="alert">
				{form.error}
			</div>
		{/if}

		{#if mfaStep}
			<!-- MFA コード入力フォーム -->
			<form
				method="POST"
				action="?/mfa"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						mfaCode = '';
						await update();
					};
				}}
				class="login-form"
			>
				<input type="hidden" name="session" value={mfaSession} />
				<input type="hidden" name="challengeName" value={mfaChallengeName} />
				<input type="hidden" name="email" value={email} />

				<p class="mfa-description">
					認証アプリに表示されている6桁のコードを入力してください。
				</p>

				<div class="form-group">
					<label for="mfaCode" class="form-label">認証コード</label>
					<input
						id="mfaCode"
						name="mfaCode"
						type="text"
						bind:value={mfaCode}
						placeholder="000000"
						required
						maxlength="6"
						pattern="[0-9]{6}"
						inputmode="numeric"
						autocomplete="one-time-code"
						class="form-input mfa-input"
					/>
				</div>

				<button type="submit" disabled={loading || mfaCode.length !== 6} class="login-button" aria-busy={loading}>
					{#if loading}
						<span class="btn-spinner" aria-hidden="true"></span>
						認証中...
					{:else}
						認証する
					{/if}
				</button>
			</form>
		{:else}
			<!-- 通常ログインフォーム -->
			<form
				method="POST"
				action="?/login"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						password = '';
						await update();
					};
				}}
				class="login-form"
			>
				<div class="form-group">
					<label for="email" class="form-label">メールアドレス</label>
					<input
						id="email"
						name="email"
						type="email"
						bind:value={email}
						placeholder="example@email.com"
						required
						autocomplete="email"
						class="form-input"
					/>
				</div>

				<div class="form-group">
					<label for="password" class="form-label">パスワード</label>
					<input
						id="password"
						name="password"
						type="password"
						bind:value={password}
						placeholder="8文字以上"
						required
						minlength="8"
						autocomplete="current-password"
						class="form-input"
					/>
				</div>

				<button type="submit" disabled={loading || !email || !password} class="login-button" aria-busy={loading}>
					{#if loading}
						<span class="btn-spinner" aria-hidden="true"></span>
						ログイン中...
					{:else}
						ログイン
					{/if}
				</button>
			</form>

			{#if !data.devMode}
				<div class="signup-link">
					<a href="/auth/signup">アカウントをお持ちでない方はこちら</a>
				</div>
			{/if}
		{/if}

		{#if data.devMode}
			<div class="dev-hint">
				<details>
					<summary>テスト用アカウント</summary>
					<ul class="dev-accounts">
						<li><code>owner@example.com</code> / <code>Gq!Dev#Owner2026x</code> (管理者)</li>
						<li><code>parent@example.com</code> / <code>Gq!Dev#Parent2026</code> (親)</li>
						<li><code>child@example.com</code> / <code>Gq!Dev#Child2026x</code> (子供)</li>
					</ul>
				</details>
			</div>
		{/if}
	</div>
</div>

<style>
	.login-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		padding: 16px;
	}

	.login-card {
		width: 100%;
		max-width: 400px;
		background: white;
		border-radius: 16px;
		padding: 40px 32px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
	}

	.login-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.login-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e293b;
		margin: 0;
	}

	.login-subtitle {
		font-size: 0.875rem;
		color: #64748b;
		margin-top: 4px;
	}

	.login-error {
		margin-bottom: 16px;
		padding: 12px 16px;
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
		border-radius: 8px;
		font-size: 0.875rem;
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-label {
		font-size: 0.875rem;
		font-weight: 600;
		color: #374151;
	}

	.form-input {
		padding: 12px 16px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 1rem;
		transition: border-color 0.15s;
		outline: none;
	}

	.form-input:focus {
		border-color: #667eea;
		box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
	}

	.mfa-input {
		text-align: center;
		font-size: 1.5rem;
		letter-spacing: 0.5em;
		font-family: monospace;
	}

	.mfa-description {
		font-size: 0.875rem;
		color: #64748b;
		text-align: center;
		margin: 0;
	}

	.login-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
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

	.btn-spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.login-button:hover:not(:disabled) {
		opacity: 0.9;
	}

	.login-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.signup-link {
		margin-top: 20px;
		text-align: center;
	}

	.signup-link a {
		font-size: 0.875rem;
		color: #667eea;
		text-decoration: none;
	}

	.signup-link a:hover {
		text-decoration: underline;
	}

	.dev-hint {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid #e5e7eb;
	}

	.dev-hint summary {
		font-size: 0.75rem;
		color: #9ca3af;
		cursor: pointer;
	}

	.dev-accounts {
		margin-top: 8px;
		padding-left: 16px;
		font-size: 0.75rem;
		color: #6b7280;
		line-height: 1.8;
	}

	.dev-accounts code {
		background: #f3f4f6;
		padding: 1px 4px;
		border-radius: 3px;
		font-size: 0.7rem;
	}
</style>

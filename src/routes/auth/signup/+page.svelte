<script lang="ts">
import { enhance } from '$app/forms';

let { form } = $props();

let email = $state(form?.email ?? '');
let password = $state('');
let passwordConfirm = $state('');
let code = $state('');
let loading = $state(false);

let confirmStep = $derived(form?.confirmStep ?? false);

// form 更新時に email を同期（enhance の form reset で消えるのを防止）
$effect(() => {
	if (form?.email) {
		email = form.email as string;
	}
});
</script>

<svelte:head>
	<title>アカウント登録 - がんばりクエスト</title>
</svelte:head>

<div class="signup-page">
	<div class="signup-card">
		<div class="signup-header">
			<div class="signup-icon">🏰</div>
			<h1 class="signup-title">がんばりクエスト</h1>
			<p class="signup-subtitle">{confirmStep ? 'メール認証' : 'アカウント登録'}</p>
		</div>

		{#if form?.error}
			<div class="signup-error" role="alert">
				{form.error}
			</div>
		{/if}

		{#if confirmStep}
			<!-- メール認証コード入力 -->
			<form
				method="POST"
				action="?/confirm"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update();
					};
				}}
				class="signup-form"
			>
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="password" value={password} />

				<p class="confirm-description">
					<strong>{email}</strong> に確認コードを送信しました。<br />
					メールに記載された6桁のコードを入力してください。
				</p>

				<div class="form-group">
					<label for="code" class="form-label">確認コード</label>
					<input
						id="code"
						name="code"
						type="text"
						bind:value={code}
						placeholder="123456"
						required
						inputmode="numeric"
						autocomplete="one-time-code"
						class="form-input code-input"
					/>
				</div>

				<button type="submit" disabled={loading || code.length < 1} class="signup-button">
					{#if loading}
						確認中...
					{:else}
						確認する
					{/if}
				</button>
			</form>
		{:else}
			<!-- 登録フォーム -->
			<form
				method="POST"
				action="?/signup"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						passwordConfirm = '';
						await update({ reset: false });
					};
				}}
				class="signup-form"
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
						placeholder="8文字以上（大小英字・数字を含む）"
						required
						minlength="8"
						autocomplete="new-password"
						class="form-input"
					/>
					<span class="form-hint">8文字以上、大文字・小文字・数字を含む</span>
				</div>

				<div class="form-group">
					<label for="passwordConfirm" class="form-label">パスワード（確認）</label>
					<input
						id="passwordConfirm"
						name="passwordConfirm"
						type="password"
						bind:value={passwordConfirm}
						placeholder="パスワードを再入力"
						required
						minlength="8"
						autocomplete="new-password"
						class="form-input"
					/>
				</div>

				<button
					type="submit"
					disabled={loading || !email || !password || !passwordConfirm}
					class="signup-button"
				>
					{#if loading}
						登録中...
					{:else}
						アカウントを作成
					{/if}
				</button>
			</form>
		{/if}

		<div class="login-link">
			<a href="/auth/login">既にアカウントをお持ちの方はこちら</a>
		</div>
	</div>
</div>

<style>
	.signup-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		padding: 16px;
	}

	.signup-card {
		width: 100%;
		max-width: 400px;
		background: white;
		border-radius: 16px;
		padding: 40px 32px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
	}

	.signup-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.signup-icon {
		font-size: 3rem;
		margin-bottom: 8px;
	}

	.signup-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e293b;
		margin: 0;
	}

	.signup-subtitle {
		font-size: 0.875rem;
		color: #64748b;
		margin-top: 4px;
	}

	.signup-error {
		margin-bottom: 16px;
		padding: 12px 16px;
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
		border-radius: 8px;
		font-size: 0.875rem;
	}

	.signup-form {
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

	.form-hint {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.code-input {
		text-align: center;
		font-size: 1.5rem;
		letter-spacing: 0.5em;
		font-family: monospace;
	}

	.confirm-description {
		font-size: 0.875rem;
		color: #64748b;
		text-align: center;
		margin: 0;
		line-height: 1.6;
	}

	.signup-button {
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

	.signup-button:hover:not(:disabled) {
		opacity: 0.9;
	}

	.signup-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.login-link {
		margin-top: 20px;
		text-align: center;
	}

	.login-link a {
		font-size: 0.875rem;
		color: #667eea;
		text-decoration: none;
	}

	.login-link a:hover {
		text-decoration: underline;
	}
</style>

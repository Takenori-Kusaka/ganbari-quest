<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data, form } = $props();

// form は複数の action から異なる型が返るためキャスト
const f = () => form as Record<string, unknown> | null;

let email = $state('');
let password = $state('');
let mfaCodeRaw = $state('');

// サーバーレスポンス（form）からのメールアドレス復元
$effect(() => {
	const formEmail = form?.email;
	if (typeof formEmail === 'string') email = formEmail;
});
const mfaCode = $derived(mfaCodeRaw.replace(/\s/g, ''));
let loading = $state(false);

// MFA ステップ: サーバーから session/challengeName が返ってきた場合
let mfaStep = $derived((f()?.mfaStep as boolean) ?? false);
let mfaSession = $derived((f()?.session as string) ?? '');
let mfaChallengeName = $derived((f()?.challengeName as string) ?? '');
</script>

<svelte:head>
	<title>ログイン - がんばりクエスト</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<div class="w-full max-w-[400px] bg-[var(--color-surface-card)] rounded-[var(--radius-md)] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		<div class="text-center mb-8">
			<Logo variant="full" size={320} />
			{#if mfaStep}
				<p class="text-sm text-[var(--color-text-muted)] mt-2 font-semibold">MFA認証</p>
			{/if}
		</div>

		{#if form?.error}
			<div class="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-[var(--radius-sm)] text-sm" role="alert">
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
						mfaCodeRaw = '';
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="session" value={mfaSession} />
				<input type="hidden" name="challengeName" value={mfaChallengeName} />
				<input type="hidden" name="email" value={email} />

				<p class="text-sm text-[var(--color-text-muted)] text-center">
					認証アプリに表示されている6桁のコードを入力してください。
				</p>

				<div class="flex flex-col gap-1.5">
					<label for="mfaCode" class="text-sm font-semibold text-[var(--color-text)]">認証コード</label>
					<input
						id="mfaCode"
						name="mfaCode"
						type="text"
						bind:value={mfaCodeRaw}
						placeholder="000000"
						required
						maxlength="12"
						inputmode="numeric"
						autocomplete="one-time-code"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-2xl text-center tracking-[0.5em] font-mono
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
				</div>

				<Button type="submit" disabled={loading || mfaCode.length !== 6} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						認証中...
					{:else}
						認証する
					{/if}
				</Button>
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
				class="flex flex-col gap-5"
			>
				<div class="flex flex-col gap-1.5">
					<label for="email" class="text-sm font-semibold text-[var(--color-text)]">メールアドレス</label>
					<input
						id="email"
						name="email"
						type="email"
						bind:value={email}
						placeholder="example@email.com"
						required
						autocomplete="email"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-base
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="password" class="text-sm font-semibold text-[var(--color-text)]">パスワード</label>
					<input
						id="password"
						name="password"
						type="password"
						bind:value={password}
						placeholder="8文字以上"
						required
						minlength="8"
						autocomplete="current-password"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-base
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
				</div>

				<Button type="submit" disabled={loading || !email || !password} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						ログイン中...
					{:else}
						ログイン
					{/if}
				</Button>
			</form>

			{#if !data.devMode}
				<div class="mt-5 text-center">
					<a href="/auth/signup" class="text-sm text-[var(--color-text-link)] hover:underline">
						アカウントをお持ちでない方はこちら
					</a>
				</div>
			{/if}
		{/if}

		{#if data.devMode}
			<div class="mt-6 pt-4 border-t border-[var(--color-border-default)]">
				<details>
					<summary class="text-xs text-[var(--color-text-muted)] cursor-pointer">テスト用アカウント</summary>
					<ul class="mt-2 pl-4 text-xs text-[var(--color-text-muted)] leading-7">
						<li><code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">owner@example.com</code> / <code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">Gq!Dev#Owner2026x</code> (管理者)</li>
						<li><code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">parent@example.com</code> / <code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">Gq!Dev#Parent2026</code> (親)</li>
						<li><code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">child@example.com</code> / <code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">Gq!Dev#Child2026x</code> (子供)</li>
					</ul>
				</details>
			</div>
		{/if}
	</div>
</div>
